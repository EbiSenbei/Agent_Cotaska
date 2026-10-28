"""Prepare owned screen footage and locally synthesized audio for the film."""
from pathlib import Path
import json
import math
import subprocess
import wave
import numpy as np

from config import MEDIA, BUILD, FF
root = BUILD / 'prepared-media'
root.mkdir(exist_ok=True)
work = MEDIA
ffmpeg = FF
raw = MEDIA / 'recordings/intro-take-01.mp4'
meta = json.loads((MEDIA / 'recordings/intro-take-01.json').read_text(encoding='utf-8'))

events = {e['event']:e['t']/1000-meta['started_epoch'] for e in json.loads((MEDIA / 'recordings/intro-events.json').read_text(encoding='utf-8'))}
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
    subprocess.run([str(ffmpeg),'-v','error','-n','-ss',str(start),'-i',str(raw),'-an','-vf',f'crop={w}:{h}:{x}:{y},scale={size[0]}:{size[1]}:flags=lanczos,fps=30,setsar=1','-frames:v',str(round(duration*30)),'-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p',str(dest)],check=True)
    subprocess.run([str(ffmpeg),'-v','error','-n','-ss','0.6','-i',str(dest),'-frames:v','1',str(clips/(name+'.png'))],check=True)
    manifest.append(dict(name=name,source_start=start,duration=duration,crop=crop,size=size))
    print('Prepared '+name,flush=True)
(root/'source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
