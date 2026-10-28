"""Prepare owned screen footage and locally synthesized audio for the film."""
from pathlib import Path
import json
import math
import subprocess
import wave
import numpy as np

root = Path(__file__).resolve().parent
work = root.parent
ffmpeg = work / 'recording-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'
raw = work / 'raw/intro-take-01.mp4'
meta = json.loads((work / 'raw/intro-take-01.json').read_text(encoding='utf-8'))
events = {e['event']:e['t']/1000-meta['started_epoch'] for e in json.loads((work / 'raw/intro-events.json').read_text(encoding='utf-8'))}
clips = root / 'clips'
clips.mkdir(exist_ok=True)

# Every inset is from the actual recording, with no reconstructed product UI.
cuts = [
    ('overview', events['overview_start']+.6, 7, (294,31,970,700), (1080,780)),
    ('chat_intro', events['ai_result']+.5, 4, (330,31,934,700), (1080,780)),
    ('detail', events['child_detail']+.8, 4, (755,31,509,600), (720,840)),
    ('open_ai', events['ai_open']-.6, 4, (294,31,970,720), (1080,780)),
    ('prompt', events['ai_prompt']+.6, 4, (330,31,934,730), (1080,780)),
    ('send', events['ai_send']-.4, 1.3, (330,31,934,730), (1080,780)),
    ('reply', events['ai_result']+.5, 5, (340,31,910,600), (1080,712)),
    ('file', events['result_file_open']+1, 4, (350,31,914,550), (1200,720)),
    ('result', events['child_result_preview']+2, 4, (755,270,509,380), (1080,806)),
    ('remaining', events['hierarchy_final']+1, 4, (755,580,509,145), (1080,308)),
    ('sections', events['overview_start']+.6, 4, (294,140,460,420), (720,658)),
    ('register_one', events['register_task_one']-.5, 1.5, (294,31,460,520), (640,724)),
    ('register_two', events['register_parent']-.5, 1.5, (294,31,460,520), (640,724)),
    ('hierarchy', events['child_register_two']+2, 4, (294,230,460,360), (900,704)),
]
manifest=[]
for name,start,duration,crop,size in cuts:
    x,y,w,h=crop
    dest=clips/(name+'.mp4')
    subprocess.run([str(ffmpeg),'-v','error','-y','-ss',str(start),'-i',str(raw),'-an','-vf',f'crop={w}:{h}:{x}:{y},scale={size[0]}:{size[1]}:flags=lanczos,fps=30,setsar=1','-frames:v',str(round(duration*30)),'-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p',str(dest)],check=True)
    subprocess.run([str(ffmpeg),'-v','error','-y','-ss','0.6','-i',str(dest),'-frames:v','1',str(clips/(name+'.png'))],check=True)
    manifest.append(dict(name=name,source_start=start,duration=duration,crop=crop,size=size))
    print('Prepared '+name,flush=True)
(root/'source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')

sr=48000
durations=[7,6,7,10,9,10,5,6]
starts=[0,7,13,20,30,39,49,54]
voice=np.zeros(sr*60,dtype=np.float64)
voice_manifest=[]
for i,(start,length) in enumerate(zip(starts,durations),1):
    source=root/f'audio/voice-{i:02d}.wav'
    with wave.open(str(source)) as f:
        duration=f.getnframes()/f.getframerate()
    lead=.3 if i<8 else .15
    available=length-lead-.15
    speed=max(1,duration/available)
    adjusted=root/f'audio/fitted-{i:02d}.wav'
    subprocess.run([str(ffmpeg),'-v','error','-y','-i',str(source),'-af',f'atempo={speed:.6f},highpass=f=75,loudnorm=I=-18:TP=-2:LRA=7','-ar',str(sr),'-ac','1','-c:a','pcm_s16le',str(adjusted)],check=True)
    with wave.open(str(adjusted)) as f:
        data=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').astype(float)/32768
    offset=round((start+lead)*sr)
    data=data[:min(len(data),round((length-lead-.08)*sr))]
    voice[offset:offset+len(data)]+=data
    voice_manifest.append(dict(scene=i,start=start+lead,duration=len(data)/sr,original_duration=duration,speed=speed,voice='Microsoft Sayaka',pronunciation={'AI':'エーアイ','Cotaska':'コタスカ','Markdown':'マークダウン'}))

# A newly composed quiet instrumental bed, generated here, not a downloaded song.
t=np.arange(sr*60)/sr
music=np.zeros((len(t),2),dtype=np.float64)
chords=[[48,55,59,64],[45,52,55,60],[41,48,52,57],[43,50,55,59]]
def freq(m):return 440*2**((m-69)/12)
beat=60/88
for bar in range(math.ceil(60/(4*beat))):
    notes=chords[bar%len(chords)]
    start=bar*4*beat
    # Soft, slow pad under each bar.
    for ni,n in enumerate(notes):
        nlen=min(4*beat+.6,60-start)
        local=np.arange(round(sr*nlen))/sr
        env=(1-np.exp(-local/0.45))*np.exp(-local/3.5)*np.minimum(1,(nlen-local)/.5)
        pad=np.sin(2*np.pi*freq(n)*local)*env*.006
        at=round(start*sr); end=min(at+len(pad),len(t));pad=pad[:end-at]
        music[at:end,0]+=pad*(.94 if ni%2 else 1)
        music[at:end,1]+=pad*(1 if ni%2 else .94)
    # Sparse felt-key arpeggio, leaving space for speech.
    for step,n in enumerate([notes[0]+12,notes[2]+12,notes[1]+12,notes[3]+12]):
        when=start+step*beat
        if when>=60:continue
        nlen=min(2,60-when);local=np.arange(round(sr*nlen))/sr
        env=(1-np.exp(-local/.012))*np.exp(-local/.42)
        key=(np.sin(2*np.pi*freq(n)*local)+.15*np.sin(2*np.pi*freq(n)*2*local))*env*.018
        at=round(when*sr);end=min(at+len(key),len(t));key=key[:end-at]
        music[at:end,0]+=key*(1 if step%2==0 else .7)
        music[at:end,1]+=key*(.7 if step%2==0 else 1)

music*=np.minimum(1,t[:,None]/1.6)*np.minimum(1,(60-t[:,None])/2)
mix=voice[:,None]+music
# Gentle original confirmation tones at the meaningful changes.
for when,notes in [(18.3,[72,76]),(33.3,[72,79]),(36.4,[76,79]),(45.4,[72,76])]:
    for j,n in enumerate(notes):
        local=np.arange(round(.32*sr))/sr
        note=np.sin(2*np.pi*freq(n)*local)*np.exp(-local*15)*(1-np.exp(-local*100))*.025
        at=round((when+j*.09)*sr);mix[at:at+len(note)]+=note[:,None]

def save(path,data):
    data=np.clip(data,-.99,.99)
    with wave.open(str(path),'wb') as f:
        f.setnchannels(data.shape[1] if data.ndim==2 else 1);f.setsampwidth(2);f.setframerate(sr)
        f.writeframes((data*32767).astype('<i2').tobytes())
save(root/'audio/narration.wav',voice)
save(root/'audio/original-bgm.wav',music)
save(root/'audio/mix.wav',mix)
(root/'audio/manifest.json').write_text(json.dumps({'duration':60,'sample_rate':sr,'scenes':voice_manifest,'music':'Original procedural composition; 88 BPM; composed by prepare_media.py','peak_before_master':float(abs(mix).max())},ensure_ascii=False,indent=2),encoding='utf-8')
print('Prepared 60-second narration and original music',flush=True)
