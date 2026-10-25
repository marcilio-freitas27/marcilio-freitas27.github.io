const PARAMS = {
  cabinet: 0x0,
  gain: 0x1,
  tone: 0x2,
  reverb: 0x3,
  feedback: 0x4,
  volume: 0x5,
  time: 0x6,
  mix: 0x7,
  modulation: 0x8,
  type: 0x9,
  ir_section: 0xA,
  delay_section: 0xB,
  tone_section: 0xC,
};

const SLOT_OFFSET = { A: 0x00, B: 0x10, C: 0x20 };
const LIVE_BASE = 0x80000000;

const PRESETS = [
  { id:'classic-rock', name:'Classic Rock', desc:'Crunch equilibrado, médios presentes.', values:{gain:76,tone:70,reverb:24,feedback:18,volume:92,time:28,mix:20,modulation:8,cabinet:3}},
  { id:'hard-rock', name:'Hard Rock', desc:'Mais ganho e presença, delay discreto.', values:{gain:93,tone:72,reverb:20,feedback:22,volume:90,time:30,mix:22,modulation:6,cabinet:4}},
  { id:'reggae', name:'Reggae Clean', desc:'Limpo, aberto e com modulação leve.', values:{gain:28,tone:84,reverb:34,feedback:12,volume:96,time:22,mix:15,modulation:34,cabinet:2}},
  { id:'black-metal', name:'Black Metal', desc:'Áspero, brilhante e com pouco ambiente.', values:{gain:112,tone:92,reverb:16,feedback:8,volume:86,time:18,mix:10,modulation:0,cabinet:5}},
  { id:'power-metal', name:'Power Metal Rhythm', desc:'High gain definido e ataque brilhante.', values:{gain:104,tone:82,reverb:18,feedback:12,volume:90,time:24,mix:12,modulation:2,cabinet:5}},
  { id:'power-lead', name:'Power Metal Lead', desc:'Lead com delay e reverb mais presentes.', values:{gain:108,tone:78,reverb:38,feedback:42,volume:94,time:62,mix:36,modulation:5,cabinet:5}},
  { id:'thrash', name:'Thrash Metal', desc:'Ataque seco, ganho alto e pouco reverb.', values:{gain:106,tone:88,reverb:10,feedback:6,volume:91,time:14,mix:8,modulation:0,cabinet:5}},
  { id:'doom', name:'Doom Metal', desc:'Escuro, grave e com bastante sustain.', values:{gain:114,tone:46,reverb:36,feedback:24,volume:88,time:44,mix:28,modulation:3,cabinet:6}},
];

const CONTROL_DEFS = [
  ['gain','Gain'],['tone','Tone'],['reverb','Reverb'],['feedback','Delay Feedback'],
  ['volume','Volume'],['time','Delay Time'],['mix','Delay Mix'],['modulation','Modulation'],['cabinet','Cabinet']
];

let midiAccess = null;
let input = null;
let output = null;
let currentSlot = 'A';
let writeEnabled = false;
let selectedPreset = null;
let values = {...PRESETS[0].values};
let writeTimer = null;

const $ = (id) => document.getElementById(id);
const statusDot = $('statusDot');
const statusText = $('connectionStatus');
const deviceName = $('deviceName');
const outputSelect = $('midiOutput');
const inputSelect = $('midiInput');
const logEl = $('midiLog');

function log(message, data) {
  const stamp = new Date().toLocaleTimeString();
  let suffix = '';
  if (data) suffix = '\n' + Array.from(data).map(v => v.toString(16).padStart(2,'0')).join(' ');
  logEl.textContent += '\n[' + stamp + '] ' + message + suffix;
  logEl.scrollTop = logEl.scrollHeight;
}

function toLE(value, bytes) {
  return Array.from({length: bytes}, (_,i) => (value >>> (8*i)) & 0xff);
}

function checksum(data) {
  let sum = 0;
  for (const b of data) sum = (sum + b) & 0xff;
  return (~sum) & 0xff;
}

function encode7(source) {
  const dest = [];
  let bitNum = 0;
  let accum = 0;
  for (const byte of source) {
    accum = (accum | (byte << (bitNum & 0x1f))) >>> 0;
    bitNum += 1;
    while (true) {
      dest.push(accum & 0x7f);
      accum >>>= 7;
      if (bitNum < 7) break;
      bitNum -= 7;
    }
  }
  dest.push(accum & 0x7f);
  return dest;
}

function buildMessage(msgType, content = []) {
  const clear = [0x00,0x59,msgType,...toLE(content.length,3),...content];
  clear.push(checksum(clear.slice(6)));
  return new Uint8Array([0xF0,...encode7(clear),0xF7]);
}

function buildWriteMemory(memoryType, address, bytes) {
  const content = [memoryType,...toLE(address,4),...toLE(bytes.length,3),...bytes];
  return buildMessage(0x22, content);
}

function buildReadMemory(memoryType, address, len) {
  const content = [memoryType,...toLE(address,4),...toLE(len,3)];
  return buildMessage(0x23, content);
}

function buildNameVersionRequest() { return buildMessage(0x11, []); }

function hex(data) { return Array.from(data).map(v=>v.toString(16).padStart(2,'0')).join(' '); }

function updateStatus() {
  const connected = !!output;
  statusDot.classList.toggle('online', connected);
  statusDot.classList.toggle('offline', !connected);
  statusText.textContent = connected ? 'MIDI conectado' : 'Desconectado';
  deviceName.textContent = output?.name || input?.name || 'Nenhum dispositivo selecionado';
}

function populatePorts() {
  const outputs = [...midiAccess.outputs.values()];
  const inputs = [...midiAccess.inputs.values()];
  outputSelect.innerHTML = outputs.map((p,i)=>'<option value="'+p.id+'">'+(p.name || 'Saída '+(i+1))+'</option>').join('') || '<option>Nenhuma saída MIDI</option>';
  inputSelect.innerHTML = inputs.map((p,i)=>'<option value="'+p.id+'">'+(p.name || 'Entrada '+(i+1))+'</option>').join('') || '<option>Nenhuma entrada MIDI</option>';

  const prefer = arr => arr.find(p => /cube|m-vave|cuvave|baby/i.test(p.name || '')) || arr[0] || null;
  output = prefer(outputs);
  input = prefer(inputs);
  if (output) outputSelect.value = output.id;
  if (input) inputSelect.value = input.id;
  bindInput();
  updateStatus();
  log('Portas detectadas: ' + outputs.length + ' saída(s), ' + inputs.length + ' entrada(s).');
}

function bindInput() {
  if (!input) return;
  input.onmidimessage = (ev) => log('RX', ev.data);
}

async function connectMidi() {
  if (!navigator.requestMIDIAccess) {
    alert('Este navegador não oferece Web MIDI. Use Chrome ou Edge no computador.');
    return;
  }
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex:true });
    midiAccess.onstatechange = populatePorts;
    populatePorts();
    log('Permissão Web MIDI/SysEx concedida.');
  } catch (err) {
    log('Falha ao conectar: ' + err.message);
    alert('Não foi possível acessar MIDI/SysEx. Verifique a permissão do navegador.');
  }
}

function send(data, label='TX') {
  if (!output) throw new Error('Nenhuma saída MIDI selecionada.');
  output.send(data);
  log(label, data);
}

function liveAddress(param) {
  return (LIVE_BASE + SLOT_OFFSET[currentSlot] + PARAMS[param]) >>> 0;
}

function sendParam(param, value) {
  if (!writeEnabled) return;
  const byte = Math.max(0, Math.min(127, Number(value))) & 0xff;
  send(buildWriteMemory(0x05, liveAddress(param), [byte]), 'TX write ' + currentSlot + '.' + param + '=' + byte);
}

function queueParam(param, value) {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try { sendParam(param, value); } catch (err) { log(err.message); }
  }, 45);
}

function renderPresets() {
  $('presetGrid').innerHTML = PRESETS.map(p =>
    '<button class="preset-card '+(selectedPreset===p.id?'active':'')+'" data-preset="'+p.id+'"><strong>'+p.name+'</strong><small>'+p.desc+'</small></button>'
  ).join('');
  document.querySelectorAll('[data-preset]').forEach(btn => btn.addEventListener('click', () => applyPreset(btn.dataset.preset)));
}

function renderControls() {
  $('controlsGrid').innerHTML = CONTROL_DEFS.map(([key,label]) =>
    '<label class="control"><div class="control-head"><span>'+label+'</span><span id="'+key+'Value">'+values[key]+'</span></div><input id="'+key+'" type="range" min="0" max="127" value="'+values[key]+'" /></label>'
  ).join('');
  CONTROL_DEFS.forEach(([key]) => {
    $(key).addEventListener('input', e => {
      values[key] = Number(e.target.value);
      $(key+'Value').textContent = values[key];
      selectedPreset = null;
      renderPresets();
      queueParam(key, values[key]);
    });
  });
}

function applyPreset(id) {
  const preset = PRESETS.find(p=>p.id===id);
  if (!preset) return;
  selectedPreset = id;
  values = {...preset.values};
  CONTROL_DEFS.forEach(([key]) => {
    $(key).value = values[key];
    $(key+'Value').textContent = values[key];
  });
  renderPresets();
  if (writeEnabled) sendAll();
}

function sendAll() {
  if (!writeEnabled) {
    alert('Ative “Permitir escrita experimental” antes de enviar parâmetros.');
    return;
  }
  try {
    let delay = 0;
    const all = [...CONTROL_DEFS.map(([key]) => [key, values[key]]),
      ['tone_section', $('tone_section').checked ? 1 : 0],
      ['delay_section', $('delay_section').checked ? 1 : 0],
      ['ir_section', $('ir_section').checked ? 1 : 0],
    ];
    all.forEach(([param,val]) => {
      setTimeout(() => {
        try { sendParam(param,val); } catch(err) { log(err.message); }
      }, delay);
      delay += 35;
    });
  } catch (err) { log(err.message); }
}

$('connectBtn').addEventListener('click', connectMidi);
outputSelect.addEventListener('change', () => { output = midiAccess?.outputs.get(outputSelect.value) || null; updateStatus(); });
inputSelect.addEventListener('change', () => { input = midiAccess?.inputs.get(inputSelect.value) || null; bindInput(); updateStatus(); });
$('writeMode').addEventListener('change', e => {
  if (e.target.checked) {
    const ok = confirm('Ativar escrita experimental? Os comandos desta versão escrevem apenas nos endereços de parâmetros em RAM documentados pela engenharia reversa.');
    if (!ok) { e.target.checked = false; return; }
  }
  writeEnabled = e.target.checked;
  log('Modo de escrita ' + (writeEnabled?'ATIVADO':'desativado') + '.');
});
$('sendAllBtn').addEventListener('click', sendAll);
$('identifyBtn').addEventListener('click', () => { try { send(buildNameVersionRequest(), 'TX identify'); } catch(e){ log(e.message); } });
$('readBtn').addEventListener('click', () => { try { send(buildReadMemory(0x05, (LIVE_BASE + SLOT_OFFSET[currentSlot])>>>0, 13), 'TX read slot ' + currentSlot); } catch(e){ log(e.message); } });
$('clearLogBtn').addEventListener('click', () => logEl.textContent = '');

document.querySelectorAll('.slot').forEach(btn => btn.addEventListener('click', () => {
  currentSlot = btn.dataset.slot;
  document.querySelectorAll('.slot').forEach(x=>x.classList.toggle('active', x===btn));
  log('Slot selecionado: ' + currentSlot);
}));

['tone_section','delay_section','ir_section'].forEach(key => $(key).addEventListener('change', e => queueParam(key, e.target.checked ? 1 : 0)));

$('secureInfo').textContent = window.isSecureContext ? 'Contexto seguro: OK' : 'Abra em HTTPS ou localhost para Web MIDI.';
renderPresets();
renderControls();
logEl.textContent = 'Pronto. Clique em “Conectar Cube Baby”.';

const test = buildWriteMemory(0x05, 0x80000009, [0x01]);
const expected = 'f0 00 32 09 49 00 00 40 02 09 00 00 00 18 00 00 00 01 5e 01 f7';
if (hex(test) !== expected) {
  console.warn('SysEx encoder self-test did not match known vector.', hex(test));
  log('ATENÇÃO: autoteste do encoder não coincidiu; mantenha a escrita desligada.');
} else {
  console.info('Cube Baby SysEx encoder self-test OK');
}