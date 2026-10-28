from pathlib import Path
import hashlib
import json
import re
import subprocess
from PIL import Image,ImageDraw,ImageFont

root=Path(__file__).resolve().parent
repo=root.parents[2]
ff=root.parent/'recording-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'
target=repo/'Cotaska/00_mgmt/Cotaska_タスク管理ツール/tasks/T-0294/attachments'
video=target/'Cotaska_紹介動画_モーショングラフィックス_v3_NemoB_60秒.mp4'
previous=target/'Cotaska_紹介動画_モーショングラフィックス_v2_NemoB_60秒.mp4'
qa=root/'branding-v3/qa';qa.mkdir(exist_ok=True)
def run(args,name):
    r=subprocess.run([str(ff),*args],capture_output=True)
    text=r.stderr.decode('utf-8',errors='replace')
    (qa/name).write_text(text,encoding='utf-8');r.check_returncode();return text
log=run(['-hide_banner','-xerror','-i',str(video),'-f','null','-'],'decode.log')
assert all(s in log for s in ['1920x1080','30 fps','00:01:00.00','Audio: aac','48000 Hz','stereo'])
assert re.search(r'frame=\s*1800',log)
def audio_hash(path):
    r=subprocess.run([str(ff),'-v','error','-i',str(path),'-map','0:a:0','-c','copy','-f','adts','pipe:1'],capture_output=True)
    r.check_returncode();return hashlib.sha256(r.stdout).hexdigest()
audio=audio_hash(video)
assert audio==audio_hash(previous),'Approved Nemo B audio changed.'
assert (target/'Cotaska_紹介動画_v3_NemoB_字幕.srt').read_bytes()==(target/'Cotaska_紹介動画_v2_NemoB_字幕.srt').read_bytes()
times=[.8,1.6,4,6.5,7.2,10,15,18.8,24.5,28.5,31.7,34.7,37.7,40.8,43.7,47.4,51.7,54.4,55,57.8,59.8]
font=ImageFont.truetype('C:/Windows/Fonts/YuGothM.ttc',20)
for page in range((len(times)+7)//8):
    sheet=Image.new('RGB',(1920,4*568),'#f8f3ed')
    for position,t in enumerate(times[page*8:(page+1)*8]):
        file=qa/f'frame-{t:04.1f}.jpg'
        run(['-v','error','-y','-ss',str(t),'-i',str(video),'-frames:v','1','-q:v','2',str(file)],'extract.log')
        sheet.paste(Image.open(file).resize((960,540),Image.Resampling.LANCZOS),((position%2)*960,(position//2)*568+28))
        ImageDraw.Draw(sheet).text(((position%2)*960+8,(position//2)*568+2),f'{t:.1f}s',font=font,fill='#493326')
    sheet.save(qa/f'contact-{page+1}.jpg',quality=95)
result={'duration':60,'frames':1800,'size_bytes':video.stat().st_size,'sha256':hashlib.sha256(video.read_bytes()).hexdigest(),'decode_exit_code':0,'aac_bitstream_identical_to_v2':True,'aac_sha256':audio,'srt_identical_to_v2':True,'inspected_frames':times}
(qa/'validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k!='inspected_frames'},ensure_ascii=False),flush=True)
