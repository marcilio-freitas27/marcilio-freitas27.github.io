# Cube Baby Web Control

Interface web experimental para M-VAVE/CUVAVE Cube Baby usando Web MIDI + SysEx.

## Recursos
- Detecta entradas/saídas MIDI no Chrome/Edge.
- Monitora mensagens recebidas.
- Solicita nome/versão do dispositivo.
- Lê os 13 bytes de parâmetros do slot A/B/C em RAM.
- Ajusta Gain, Tone, Reverb, Feedback, Volume, Time, Mix, Modulation, Cabinet e seções.
- Presets de Classic Rock, Hard Rock, Reggae, Black Metal, Power Metal, Thrash e Doom.
- Escrita protegida por confirmação e desativada por padrão.

## Segurança
A escrita usa apenas WriteMemory no tipo de memória 0x05, endereço de RAM 0x80000000 + slot + parâmetro documentado por engenharia reversa. Não há comandos de erase, firmware ou escrita de IR/ROM nesta interface.

Projeto não oficial e sem vínculo com M-VAVE/CUVAVE.