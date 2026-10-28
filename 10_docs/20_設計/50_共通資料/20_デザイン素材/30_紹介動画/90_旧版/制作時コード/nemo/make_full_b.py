"""Replace the approved film narration with the user's selected Nemo voice B."""
from pathlib import Path
import io
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import wave
import numpy as np
from PIL import Image,ImageDraw,ImageFont

root=Path(__file__).resolve().parent
work=root.parent
repo=work.parents[1]
motion=work/'motion'
dest=repo/'Cotaska/00_mgmt/Cotaska_タスク管理ツール/tasks/T-0294/attachments'
out=root/'full-B';out.mkdir(exist_ok=True)
ff=work/'recording-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'
style=10006
starts=[0,7,13,20,30,39,49,54]
lengths=[7,6,7,10,9,10,5,6]
texts=[
    'タスク管理と、エーアイチャットを、ひとつの作業画面に。コタスカ。',
    'エーアイに頼むたび、仕事の背景を説明し直していませんか？',
    'やりたいことと、完了条件をタスクに。そのままエーアイへ相談できます。',
    '例えば、サイトの紹介文づくり。子タスクから依頼すれば、タスクの内容を参照して、エーアイが作業を進めます。',
    '返答も、作成したファイルも確認。対応結果をタスクに残し、次の仕事へつなげられます。',
    '日々の仕事は、遅延、今日、完了で見やすく。複数のタスクや子タスクで、作業を整理できます。',
    'タスクは、手元のマークダウンファイルに残ります。',
    'タスク管理と、エーアイチャットを、ひとつの作業画面に。コタスカ。'
]
subtitles=[
    'タスク管理とAIチャットを、\nひとつの作業画面に。Cotaska。',
    'AIに頼むたび、仕事の背景を\n説明し直していませんか。',
    'やりたいことと、完了条件をタスクに。\nそのままAIへ相談できます。',
    '例えば、サイトの紹介文づくり。子タスクから依頼すれば、\nタスクの内容を参照して、AIが作業を進めます。',
    '返答も、作成したファイルも確認。対応結果をタスクに残し、\n次の仕事へつなげられます。',
    '日々の仕事は、遅延・今日・完了で見やすく。\n複数のタスクや子タスクで、作業を整理できます。',
    'タスクは、手元のMarkdownファイルに残ります。',
    'タスク管理とAIチャットを、\nひとつの作業画面に。Cotaska。'
]

port=50129
with socket.socket() as s:s.bind(('127.0.0.1',port))
env=os.environ.copy()
env['APPDATA']=str(root/'appdata');env['LOCALAPPDATA']=str(root/'localappdata')
runtime=root/'runtime/windows-cpu'
log=(out/'engine.log').open('w',encoding='utf-8')
proc=subprocess.Popen([str(runtime/'run.exe'),'--host','127.0.0.1','--port',str(port),'--cpu_num_threads','4','--output_log_utf8','--disable_mutable_api'],cwd=runtime,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
url=f'http://127.0.0.1:{port}'
def synthesize(query):
    req=urllib.request.Request(url+'/synthesis?speaker='+str(style),data=json.dumps(query).encode('utf-8'),headers={'Content-Type':'application/json'},method='POST')
    return urllib.request.urlopen(req,timeout=180).read()
def wav_duration(data):
    with wave.open(io.BytesIO(data)) as f:return f.getnframes()/f.getframerate()
manifest=[]
try:
    for attempt in range(60):
        if proc.poll() is not None:raise RuntimeError('Nemo exited during startup')
        try:
            speakers=json.load(urllib.request.urlopen(url+'/speakers',timeout=1))
            assert any(s['name']=='女声6' and any(t['id']==style for t in s['styles']) for s in speakers)
            break
        except Exception:time.sleep(.5)
    else:raise RuntimeError('Nemo startup timeout')
    for i,(text,start,length) in enumerate(zip(texts,starts,lengths),1):
        lead=.3 if i!=8 else .15
        if i in [1,2,8]:
            sample=1 if i==8 else i
            data=(root/f'audio/B-{sample:02d}.wav').read_bytes()
            query=json.loads((root/f'audio/B-{sample:02d}-query.json').read_text(encoding='utf-8'))
            reused=True
        else:
            req=urllib.request.Request(url+'/audio_query?'+urllib.parse.urlencode({'text':text,'speaker':style}),method='POST')
            query=json.load(urllib.request.urlopen(req,timeout=90))
            query.update(speedScale=1.0,intonationScale=1.0,pitchScale=0.0,volumeScale=1.0,prePhonemeLength=.12,postPhonemeLength=.16,outputSamplingRate=48000,outputStereo=False)
            data=synthesize(query)
            reused=False
        original_duration=wav_duration(data)
        available=length-lead-.2
        if original_duration>available:
            query['speedScale']=original_duration/(available-.05)
            data=synthesize(query)
        duration=wav_duration(data)
        assert duration<length-lead-.1,'Speech exceeds its scene; do not truncate.'
        (out/f'voice-{i:02d}.wav').write_bytes(data)
        (out/f'voice-{i:02d}-query.json').write_text(json.dumps(query,ensure_ascii=False,indent=2),encoding='utf-8')
        manifest.append({'scene':i,'start':start+lead,'duration':duration,'original_duration':original_duration,'speedScale':query['speedScale'],'intonationScale':query['intonationScale'],'pitchScale':query['pitchScale'],'reused_selected_sample':reused,'text':text,'subtitle':subtitles[i-1]})
        print(f'Scene {i}/8: {duration:.2f}s, speed {query["speedScale"]:.3f}',flush=True)
finally:
    if proc.poll() is None:proc.terminate();proc.wait(timeout=15)
    log.close()
    print('Nemo engine stopped.',flush=True)

sr=48000
voice=np.zeros((sr*60,1),float)
def read(file):
    with wave.open(str(file)) as f:
        assert f.getframerate()==sr and f.getsampwidth()==2
        return np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').astype(float).reshape(-1,f.getnchannels())/32768
def save(file,data):
    assert abs(data).max()<1,'Do not clip the master waveform'
    with wave.open(str(file),'wb') as f:
        f.setnchannels(data.shape[1]);f.setsampwidth(2);f.setframerate(sr);f.writeframes((data*32767).astype('<i2').tobytes())
for item in manifest:
    i=item['scene']
    adjusted=out/f'normalized-{i:02d}.wav'
    subprocess.run([str(ff),'-v','error','-y','-i',str(out/f'voice-{i:02d}.wav'),'-af','highpass=f=65,loudnorm=I=-18:TP=-2:LRA=7','-ar',str(sr),'-ac','1','-c:a','pcm_s16le',str(adjusted)],check=True)
    data=read(adjusted);offset=round(item['start']*sr)
    voice[offset:offset+len(data)]+=data
    item['normalized_duration']=len(data)/sr

# Retain the existing original BGM; recreate its four original confirmation sounds.
bed=read(motion/'audio/original-bgm.wav')
def freq(n):return 440*2**((n-69)/12)
for when,notes in [(18.3,[72,76]),(33.3,[72,79]),(36.4,[76,79]),(45.4,[72,76])]:
    for j,n in enumerate(notes):
        local=np.arange(round(.32*sr))/sr
        note=np.sin(2*np.pi*freq(n)*local)*np.exp(-local*15)*(1-np.exp(-local*100))*.025
        offset=round((when+j*.09)*sr);bed[offset:offset+len(note)]+=note[:,None]
save(out/'narration.wav',voice)
save(out/'music-and-effects.wav',bed)
save(out/'mix.wav',voice+bed)
(out/'manifest.json').write_text(json.dumps({'voice':'VOICEVOX Nemo 女声6','speaker':style,'engine':'0.26.0','duration':60,'scenes':manifest},ensure_ascii=False,indent=2),encoding='utf-8')

# Match the exact paper background behind the closing credit; preserve the visuals.
sys.path.insert(0,str(motion))
from render_film import BG
overlay=Image.new('RGBA',(1920,1080))
overlay.paste(BG.crop((80,995,860,1044)).convert('RGBA'),(80,995))
d=ImageDraw.Draw(overlay)
d.text((88,1005),'音声：VOICEVOX Nemo（女声6）',font=ImageFont.truetype('C:/Windows/Fonts/YuGothM.ttc',24),fill='#75675f')
label=out/'closing-credit.png';overlay.save(label)
video=dest/'Cotaska_紹介動画_モーショングラフィックス_v2_NemoB_60秒.mp4'
subprocess.run([str(ff),'-hide_banner','-loglevel','error','-n','-i',str(motion/'motion-picture.mp4'),'-i',str(out/'mix.wav'),'-loop','1','-framerate','30','-i',str(label),'-filter_complex',"[0:v][2:v]overlay=0:0:enable='gte(t,54)',format=yuv420p[v]",'-map','[v]','-map','1:a:0','-frames:v','1800','-t','60','-c:v','libx264','-preset','fast','-crf','18','-af','loudnorm=I=-16:TP=-1.5:LRA=7','-ar','48000','-c:a','aac','-b:a','192k','-movflags','+faststart','-metadata','title=Cotaska タスク管理とAIチャットをひとつの作業画面に','-metadata','comment=音声：VOICEVOX Nemo（女声6）',str(video)],check=True)
subprocess.run([str(ff),'-v','error','-n','-ss','57.8','-i',str(video),'-frames:v','1','-q:v','2',str(dest/'Cotaska_紹介動画_v2_NemoB_サムネイル.jpg')],check=True)
shutil.copy2(out/'narration.wav',dest/'Cotaska_紹介動画_v2_NemoB_ナレーション.wav')
def ts(t):
    n=round(t*1000);return f'{n//3600000:02d}:{n//60000%60:02d}:{n//1000%60:02d},{n%1000:03d}'
srt='\n\n'.join(f'{i}\n{ts(item["start"])} --> {ts(item["start"]+item["normalized_duration"])}\n{item["subtitle"]}' for i,item in enumerate(manifest,1))+'\n'
(dest/'Cotaska_紹介動画_v2_NemoB_字幕.srt').write_text(srt,encoding='utf-8-sig')
print('Saved '+str(video),flush=True)
