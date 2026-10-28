"""Increase product-name prominence and header legibility; preserve Nemo B audio."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import subprocess
from PIL import Image,ImageDraw
import render_film as film

from config import BUILD, MEDIA

root=BUILD
edit=BUILD
target=BUILD
logo_path=MEDIA/'logo/Cotaskaロゴ_案01_背景透過_白縁20px_輪郭調整.png'
logo=Image.open(logo_path).convert('RGBA')
bounds=logo.getbbox()
logo=logo.crop(bounds)
intro_logo=logo.resize((720,round(logo.height*720/logo.width)),Image.Resampling.LANCZOS)
closing_logo=logo.resize((1100,round(logo.height*1100/logo.width)),Image.Resampling.LANCZOS)
base_audio_video=Path(os.environ.get('COTASKA_AUDIO_MASTER', MEDIA/'audio/approved-master.m4a')).resolve()
output=target/'Cotaska_紹介動画_モーショングラフィックス_v3_NemoB_60秒.mp4'

def base_frame(scene,t):
    im=film.BG.copy().convert('RGBA');d=ImageDraw.Draw(im)
    if scene!=7:
        film.paste(im,film.LOGO_SMALL,88,49)
        film.txt(im,'タスクから、AIとの作業へ。',330,64,40,film.BRAND,True)
        film.txt(im,f'{scene+1:02d} / 08',1742,76,23,film.MUTED)
        d.line((88,158,1832,158),fill=film.LINE,width=2)
    if scene==7:
        film.txt(im,'音声：VOICEVOX Nemo（女声6）',88,1009,24,film.MUTED)
    else:
        film.txt(im,film.STAGES[scene],88,1010,19,film.MUTED)
    film.txt(im,'Cotaska',1741,1010,19,film.MUTED)
    global_t=film.STARTS[scene]+t
    d.rectangle((88,1052,1832,1055),fill=film.LINE)
    d.rectangle((88,1052,88+1744*global_t/60,1055),fill=film.CORAL)
    return im

def intro(t):
    im=base_frame(0,t)
    for i,(line,col) in enumerate([('タスク管理と',film.INK),('AIチャットを、',film.CORAL),('ひとつの',film.INK),('作業画面に。',film.INK)]):
        film.reveal(im,line,96,248+i*117,88,col,True,t=t,delay=i*.36)
    p=film.ease((t-.95)/.75)
    film.paste(im,intro_logo,96,723+22*(1-p),p)
    film.reveal(im,'タスクの文脈から、AIとの作業が始まる。',102,956,25,film.MUTED,t=t,delay=1.75)
    p=film.ease((t-.5)/1)
    x=film.mix(1110,1050,p)
    film.screen(im,'overview',min(t,6),round(x),287,760,549,p)
    if t>3.4:film.screen(im,'chat_intro',t-3.4,round(x),287,760,549,film.ease((t-3.4)/.5))
    film.pill(im,'ひとつのCotaskaで',round(x)+229,218,film.BRAND,'#efddcf',26,p)
    pi=film.ease((t-1.2)/.6)
    film.paste(im,film.icon('tasks',48),1110,888,pi)
    film.txt(im,'タスク管理',1177,895,26,film.BRAND,True,pi)
    film.paste(im,film.icon('arrow',45),1385,889,pi)
    film.paste(im,film.icon('chat',48),1493,888,pi)
    film.txt(im,'AIチャット',1558,895,26,film.CORAL,True,pi)
    return im

def closing(t):
    im=base_frame(7,t)
    p=film.ease(t/.75)
    film.paste(im,closing_logo,(1920-closing_logo.width)//2,100+25*(1-p),p)
    p1=film.ease((t-.35)/.7);p2=film.ease((t-.7)/.7)
    film.runs(im,[('タスク管理と',film.INK),('AIチャット',film.CORAL),('を、',film.INK)],960,480+25*(1-p1),80,True,p1,True)
    film.txt(im,'ひとつの作業画面に。',960,590+25*(1-p2),86,film.INK,True,p2,True)
    p3=film.ease((t-1.1)/.6)
    film.box(im,647,740,626,100,film.BRAND,20,p3)
    film.txt(im,'公式サイトで詳しく',960,772,35,'#fff8f2',True,p3,True)
    film.txt(im,'ebisenbei.github.io/cotaska-site/',960,894,35,film.BRAND,False,p3,True)
    return im

film.base_frame=base_frame
film.SCENES[0]=intro
film.SCENES[7]=closing

def preview():
    film.PREVIEW=True
    qa=edit/'preview';qa.mkdir(exist_ok=True)
    times=[.8,1.6,4,6.5,10,15,24.5,34.7,47.4,51.7,55,57.8]
    contact=Image.new('RGB',(1920,4*386),film.PAPER)
    for i,t in enumerate(times):
        im=film.frame(t);im.save(qa/f'frame-{t:.1f}.jpg',quality=95)
        contact.paste(im.resize((640,360),Image.Resampling.LANCZOS),((i%3)*640,(i//3)*386+26))
        ImageDraw.Draw(contact).text(((i%3)*640+8,(i//3)*386+4),f'{t:.1f}s',font=film.font(17),fill=film.INK)
    contact.save(qa/'contact.jpg',quality=95)
    print(qa/'contact.jpg',flush=True)

def render():
    if output.exists():raise RuntimeError('Preserve existing output.')
    silent=edit/'motion-picture.mp4'
    log=(edit/'render.log').open('w',encoding='utf-8')
    proc=subprocess.Popen([str(film.FF),'-hide_banner','-loglevel','warning','-n','-f','rawvideo','-pix_fmt','rgb24','-s','1920x1080','-r','30','-i','-','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-frames:v','1800','-movflags','+faststart',str(silent)],stdin=subprocess.PIPE,stderr=log)
    try:
        for i in range(1800):
            proc.stdin.write(film.frame(i/30).tobytes())
            if i%150==0:print(f'Rendered {i}/1800 ({i/30:.0f}s)',flush=True)
        proc.stdin.close()
        if proc.wait():raise RuntimeError('Encoder failed.')
    finally:
        for reader in film.READERS.values():reader.close()
        log.close()
    subprocess.run([str(film.FF),'-v','error','-n','-i',str(silent),'-i',str(base_audio_video),'-map','0:v:0','-map','1:a:0','-c','copy','-t','60','-movflags','+faststart','-metadata','title=Cotaska タスク管理とAIチャットをひとつの作業画面に','-metadata','comment=音声：VOICEVOX Nemo（女声6）',str(output)],check=True)
    shutil.copy2(MEDIA/'audio/subtitles.srt',target/'Cotaska_紹介動画_v3_NemoB_字幕.srt')
    subprocess.run([str(film.FF),'-v','error','-n','-ss','57.8','-i',str(output),'-frames:v','1','-q:v','2',str(target/'Cotaska_紹介動画_v3_NemoB_サムネイル.jpg')],check=True)
    (edit/'manifest.json').write_text(json.dumps({'output':str(output),'audio_source':str(base_audio_video),'logo_source':str(logo_path.relative_to(MEDIA)),'logo_sha256':hashlib.sha256(logo_path.read_bytes()).hexdigest(),'logo_crop':list(bounds),'intro_logo_size':list(intro_logo.size),'closing_logo_size':list(closing_logo.size),'header_font_before':23,'header_font_after':40,'duration':60,'fps':30,'frames':1800},ensure_ascii=False,indent=2),encoding='utf-8')
    print(output,flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--preview',action='store_true');args=parser.parse_args()
    preview() if args.preview else render()
