"""Deterministic 60-second motion-graphics film, using genuine screen footage."""
from pathlib import Path
from functools import lru_cache
import argparse
import json
import math
import subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent
WORK = ROOT.parent
REPO = WORK.parents[1]
FF = WORK / 'recording-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'
OUT = REPO / 'Cotaska/00_mgmt/Cotaska_タスク管理ツール/tasks/T-0294/attachments'
W,H,FPS = 1920,1080,30
INK='#2d241f'; MUTED='#75675f'; PAPER='#f8f3ed'; PANEL='#fffdfa'
LINE='#e7d9cc'; BRAND='#493326'; CORAL='#ad563c'; PEACH='#f2c8a7'
GREEN='#417354'; SOFT='#f6e4d6'
STARTS=[0,7,13,20,30,39,49,54,60]
STAGES=['タスク管理 × AIチャット','背景も、一緒に伝える','タスクから相談','AIへ作業を依頼','結果を次の仕事へ','日々の仕事も整理','Markdownで手元に','Cotaska']
SOURCES=json.loads((ROOT/'source-manifest.json').read_text(encoding='utf-8'))
SIZES={m['name']:m['size'] for m in SOURCES}

def clamp(v):return max(0,min(1,v))
def ease(v):return 1-(1-clamp(v))**4
def smooth(v):return .5-.5*math.cos(math.pi*clamp(v))
def mix(a,b,p):return a+(b-a)*p

@lru_cache(maxsize=90)
def font(size,bold=False):
    return ImageFont.truetype('C:/Windows/Fonts/'+('YuGothB.ttc' if bold else 'YuGothM.ttc'),size)

@lru_cache(maxsize=700)
def text_sprite(text,size,color=INK,bold=False):
    f=font(size,bold)
    box=f.getbbox(text)
    im=Image.new('RGBA',(max(1,box[2]-box[0]+5),max(1,box[3]-box[1]+5)))
    ImageDraw.Draw(im).text((-box[0],-box[1]),text,font=f,fill=color,stroke_width=0)
    return im

def paste(im,layer,x,y,opacity=1,scale=1):
    if opacity<=0:return
    if abs(scale-1)>.001:
        layer=layer.resize((max(1,round(layer.width*scale)),max(1,round(layer.height*scale))),Image.Resampling.LANCZOS)
    if opacity<.999:
        layer=layer.copy();layer.putalpha(layer.getchannel('A').point(lambda a:round(a*opacity)))
    im.paste(layer,(round(x),round(y)),layer)

def txt(im,text,x,y,size=40,color=INK,bold=False,opacity=1,center=False):
    layer=text_sprite(text,size,color,bold)
    if center:x-=layer.width/2
    paste(im,layer,x,y,opacity)

def reveal(im,text,x,y,size=40,color=INK,bold=False,at=0,t=0,delay=0):
    p=ease((t-at-delay)/.65)
    txt(im,text,x,y+28*(1-p),size,color,bold,p)

def runs(im,items,x,y,size,bold=True,opacity=1,center=False):
    layers=[text_sprite(text,size,col,bold) for text,col in items]
    if center:x-=sum(p.width for p in layers)/2
    for layer in layers:
        paste(im,layer,x,y,opacity);x+=layer.width

@lru_cache(maxsize=100)
def panel(w,h,color=PANEL,radius=28,shadow=True):
    im=Image.new('RGBA',(w+64,h+64))
    if shadow:
        s=Image.new('RGBA',im.size)
        ImageDraw.Draw(s).rounded_rectangle((32,44,32+w,44+h),radius=radius,fill=(60,38,22,30))
        im.alpha_composite(s.filter(ImageFilter.GaussianBlur(17)))
    ImageDraw.Draw(im).rounded_rectangle((32,32,32+w,32+h),radius=radius,fill=color,outline=LINE,width=2)
    return im

def box(im,x,y,w,h,color=PANEL,radius=28,opacity=1):
    paste(im,panel(w,h,color,radius),x-32,y-32,opacity)

def pill(im,text,x,y,color=CORAL,fill=SOFT,size=24,opacity=1):
    tw=text_sprite(text,size,color,True).width
    layer=Image.new('RGBA',(tw+42,size+28))
    ImageDraw.Draw(layer).rounded_rectangle((0,0,layer.width-1,layer.height-1),radius=(size+28)//2,fill=fill)
    paste(layer,text_sprite(text,size,color,True),21,13)
    paste(im,layer,x,y,opacity)
    return layer.width

@lru_cache(maxsize=60)
def icon(kind,size=64,color=CORAL):
    im=Image.new('RGBA',(size,size));d=ImageDraw.Draw(im)
    s=size/64;xy=lambda a:tuple(round(v*s) for v in a)
    if kind=='tasks':
        for y in [12,29,46]:
            d.rounded_rectangle(xy((6,y,17,y+11)),radius=round(3*s),outline=color,width=max(2,round(2*s)))
            d.line(xy((26,y+5,58,y+5)),fill=color,width=round(3*s))
    elif kind=='chat':
        d.rounded_rectangle(xy((5,7,59,48)),radius=round(12*s),outline=color,width=round(3*s))
        d.line(xy((18,48,18,59,32,48)),fill=color,width=round(3*s))
        for x in [20,32,44]:d.ellipse(xy((x-2,25,x+2,29)),fill=color)
    elif kind=='check':
        d.ellipse(xy((2,2,62,62)),fill=GREEN)
        d.line(xy((17,32,27,42,47,20)),fill='white',width=round(5*s))
    elif kind=='file':
        d.rounded_rectangle(xy((13,4,52,60)),radius=round(5*s),outline=color,width=round(3*s))
        for y in [23,33,43]:d.line(xy((22,y,44,y)),fill=color,width=round(3*s))
    elif kind=='arrow':
        d.line(xy((5,32,57,32)),fill=color,width=round(4*s))
        d.line(xy((43,18,58,32,43,46)),fill=color,width=round(4*s))
    return im

def task_card(im,x,y,w,title,subtitle=None,status=None,opacity=1,accent=False):
    h=148 if subtitle else 112
    box(im,x,y,w,h,'#fff8f1' if accent else PANEL,22,opacity)
    d=ImageDraw.Draw(im)
    if opacity>.9:
        if status=='完了':
            d.rounded_rectangle((round(x+24),round(y+30),round(x+48),round(y+54)),radius=6,fill=GREEN)
            d.line((round(x+29),round(y+42),round(x+34),round(y+47),round(x+44),round(y+36)),fill='white',width=3)
        else:
            d.rounded_rectangle((round(x+24),round(y+30),round(x+48),round(y+54)),radius=6,outline=CORAL if accent else MUTED,width=2)
    txt(im,title,x+69,y+27,30,INK,True,opacity)
    if subtitle:txt(im,subtitle,x+69,y+88,23,MUTED,False,opacity)
    if status:pill(im,status,x+w-108,y+32,GREEN if status=='完了' else MUTED,'#e8f0e9' if status=='完了' else '#eee8e2',20,opacity)

# Paper background and restrained warm light, sampled once rather than per frame.
yy,xx=np.mgrid[0:H,0:W]
base=np.zeros((H,W,3),dtype=np.float32);base[:]=[248,243,237]
glow=np.exp(-(((xx-1580)/700)**2+((yy-220)/700)**2))*0.58
for c,value in enumerate([242,200,167]):base[:,:,c]=base[:,:,c]*(1-glow)+value*glow
BG=Image.fromarray(np.uint8(np.clip(base,0,255)),'RGB')
del yy,xx,base,glow
LOGO=Image.open(ROOT/'assets/logo.png').convert('RGBA')
LOGO_SMALL=LOGO.resize((204,77),Image.Resampling.LANCZOS)
STILLS={name:Image.open(ROOT/'clips'/f'{name}.png').convert('RGB') for name in SIZES}

class Reader:
    def __init__(self,name):
        self.name=name;self.w,self.h=SIZES[name];self.frame=-1;self.image=STILLS[name]
        self.proc=subprocess.Popen([str(FF),'-v','error','-i',str(ROOT/'clips'/f'{name}.mp4'),'-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    def get(self,t):
        target=round(t*FPS)
        while self.frame<target:
            data=self.proc.stdout.read(self.w*self.h*3)
            if len(data)!=self.w*self.h*3:break
            self.image=Image.frombytes('RGB',(self.w,self.h),data);self.frame+=1
        return self.image
    def close(self):
        self.proc.stdout.close();self.proc.terminate();self.proc.wait()

READERS={};PREVIEW=False
def footage(name,t=0):
    if PREVIEW:return STILLS[name]
    if name not in READERS:READERS[name]=Reader(name)
    return READERS[name].get(t)

def screen(im,name,t,x,y,w,h=None,opacity=1,crop=None):
    source=footage(name,max(0,t))
    if crop:source=source.crop(crop)
    if h is None:h=round(source.height*w/source.width)
    box(im,x-10,y-10,w+20,h+20,PANEL,22,opacity)
    source=source.resize((w,h),Image.Resampling.LANCZOS).convert('RGBA')
    mask=Image.new('L',(w,h));ImageDraw.Draw(mask).rounded_rectangle((0,0,w-1,h-1),radius=14,fill=255)
    source.putalpha(mask)
    paste(im,source,x,y,opacity)

def base_frame(scene,t):
    im=BG.copy().convert('RGBA')
    d=ImageDraw.Draw(im)
    if scene!=7:
        paste(im,LOGO_SMALL,88,49)
        txt(im,'タスクから、AIとの作業へ。',327,76,23,MUTED)
        txt(im,f'{scene+1:02d} / 08',1742,76,23,MUTED)
        d.line((88,158,1832,158),fill=LINE,width=2)
    txt(im,STAGES[scene],88,1010,19,MUTED)
    txt(im,'Cotaska',1741,1010,19,MUTED)
    global_t=STARTS[scene]+t
    d.rectangle((88,1052,1832,1055),fill=LINE)
    d.rectangle((88,1052,88+1744*global_t/60,1055),fill=CORAL)
    return im

def scene0(t):
    im=base_frame(0,t)
    for i,(line,col) in enumerate([('タスク管理と',INK),('AIチャットを、',CORAL),('ひとつの',INK),('作業画面に。',INK)]):
        reveal(im,line,96,248+i*117,88,col,True,t=t,delay=i*.36)
    reveal(im,'Cotaska',102,797,44,BRAND,True,t=t,delay=1.6)
    reveal(im,'タスクの文脈から、AIとの作業が始まる。',102,869,29,MUTED,t=t,delay=2.1)
    p=ease((t-.5)/1)
    x=mix(1110,1050,p)
    screen(im,'overview',min(t,6),round(x),287,760,549,p)
    if t>3.4:screen(im,'chat_intro',t-3.4,round(x),287,760,549,ease((t-3.4)/.5))
    pill(im,'ひとつのCotaskaで',round(x)+229,218,BRAND,'#efddcf',26,p)
    pi=ease((t-1.2)/.6)
    paste(im,icon('tasks',48),1110,888,pi)
    txt(im,'タスク管理',1177,895,26,BRAND,True,pi)
    paste(im,icon('arrow',45),1385,889,pi)
    paste(im,icon('chat',48),1493,888,pi)
    txt(im,'AIチャット',1558,895,26,CORAL,True,pi)
    return im

def scene1(t):
    im=base_frame(1,t)
    reveal(im,'背景の説明、また最初から？',96,214,76,INK,True,t=t)
    p=ease((t-.35)/.7)
    x=160; y=404+round(24*(1-p))
    box(im,x,y,650,426,PANEL,28,p)
    paste(im,icon('tasks',60),x+34,y+31,p)
    txt(im,'紹介文を作る',x+114,y+40,36,INK,True,p)
    pill(im,'目的',x+34,y+137,size=25,opacity=p)
    txt(im,'Cotaskaの使いやすさを伝える',x+34,y+205,31,INK,False,p)
    pill(im,'完了条件',x+34,y+279,size=25,opacity=p)
    txt(im,'紹介文を作成して、ファイルへ保存',x+34,y+347,29,INK,False,p)
    q=ease((t-.8)/.7)
    box(im,1055,403,695,426,PANEL,28,q)
    paste(im,icon('chat',64),1094,437,q)
    txt(im,'AIへ依頼',1181,447,36,INK,True,q)
    for ly,ww in [(548,480),(605,410),(662,470)]:
        if q>.9:ImageDraw.Draw(im).rounded_rectangle((1094,ly,1094+ww,ly+13),radius=7,fill='#e9e1d9')
    txt(im,'背景・目的・完了条件を入力…',1094,744,28,MUTED,False,q)
    paste(im,icon('arrow',80),898,572,q)
    # Repeated explanation cards travel along the connector as a clearly labelled diagram.
    for k in range(3):
        phase=(t-1.25-k*.95)/1.25
        if 0<phase<1:
            move=smooth(phase);alpha=min(1,phase/.15,(1-phase)/.18)
            cx=mix(680,1180,move);cy=600-105*math.sin(move*math.pi)
            box(im,round(cx),round(cy),254,103,'#f7e2d1',18,alpha)
            txt(im,'説明をもう一度',cx+24,cy+35,25,CORAL,True,alpha)
    txt(im,'目的も、完了条件も、毎回もう一度。',960,922,34,MUTED,False,ease((t-1.3)/.6),True)
    pill(im,'図解',1680,919,MUTED,'#eee5dc',19)
    return im

def scene2(t):
    im=base_frame(2,t)
    reveal(im,'タスクの内容を、',96,212,68,INK,True,t=t)
    reveal(im,'そのままAIとの会話へ。',96,301,68,CORAL,True,t=t,delay=.25)
    if t<3.55:
        p=ease((t-.35)/.6)
        task_card(im,112,462,720,'紹介ページを公開する',opacity=p)
        ImageDraw.Draw(im).line((151,575,151,638,183,638),fill='#d1b19a',width=4)
        task_card(im,184,596,648,'Cotaskaの紹介文を作る',opacity=p,accent=True)
        pill(im,'目的と完了条件を共有',186,779,BRAND,'#efddcf',30,p)
        screen(im,'detail',t,1100,240,610,712,ease((t-.5)/.7))
        pill(im,'実画面',1598,918,MUTED,'#eee5dc',19)
    else:
        local=t-3.55
        task_card(im,111,478,572,'紹介文を作る',opacity=1,accent=True)
        paste(im,icon('chat',66),129,667)
        txt(im,'参照タスクを添えて',222,676,31,BRAND,True)
        txt(im,'AIへ相談・作業依頼。',130,763,35,CORAL,True)
        screen(im,'open_ai',local,983,386,830,599,ease(local/.35))
    return im

def scene3(t):
    im=base_frame(3,t)
    reveal(im,'例えば、サイトの紹介文づくり。',96,211,66,INK,True,t=t)
    if t<3:
        q=ease((t-.5)/.65)
        box(im,174,415,1260,310,PANEL,32,q)
        paste(im,icon('chat',90),221,471,q)
        txt(im,'このタスクの紹介文を作って',365,477,60,CORAL,True,q)
        pill(im,'参照：Cotaskaの紹介文を作る',367,609,BRAND,'#efddcf',29,q)
        paste(im,icon('arrow',98),1558,519,q)
        reveal(im,'タスクに書いた前提を、依頼と一緒に。',187,847,36,MUTED,t=t,delay=.8)
        pill(im,'依頼のイメージ',1550,920,MUTED,'#eee5dc',19)
    else:
        local=t-3
        reveal(im,'タスクを参照して、',96,408,47,INK,True,t=local)
        reveal(im,'AIが作業。',96,477,65,CORAL,True,t=local,delay=.2)
        paste(im,icon('tasks',63),105,653)
        txt(im,'目的',193,650,32,INK,True)
        txt(im,'完了条件',193,708,32,INK,True)
        txt(im,'参照タスク',193,766,32,INK,True)
        name='prompt' if local<2.7 else 'send' if local<3.8 else 'reply'
        st=local if local<2.7 else local-2.7 if local<3.8 else local-3.8
        screen(im,name,st,940,350,870,628 if name!='reply' else 574,ease(local/.3))
        if local>3.8:pill(im,'AIの待ち時間を短縮しています',1080,963,MUTED,'#eee5dc',21)
        else:pill(im,'実画面',1680,970,MUTED,'#eee5dc',19)
    return im

def scene4(t):
    im=base_frame(4,t)
    reveal(im,'返答も、成果物も、',96,211,68,INK,True,t=t)
    reveal(im,'その先の仕事も。',96,301,68,CORAL,True,t=t,delay=.2)
    if t<3:
        p=ease((t-.4)/.6)
        paste(im,icon('file',78),111,484,p)
        txt(im,'紹介文.md',113,608,47,BRAND,True,p)
        txt(im,'作成したファイルを開く',114,708,29,MUTED,False,p)
        screen(im,'file',t,810,395,1000,600,p)
        pill(im,'実際に保存した成果物',1278,960,MUTED,'#eee5dc',21)
    elif t<6:
        local=t-3
        paste(im,icon('check',80),113,475)
        txt(im,'タスクに、',113,608,43,INK,True)
        txt(im,'結果が残る。',113,674,43,CORAL,True)
        screen(im,'result',local,715,480,1080,260,ease(local/.3),crop=(0,500,1080,760))
        pill(im,'実施結果と保存先',1439,837,MUTED,'#eee5dc',21)
    else:
        local=t-6
        task_card(im,112,481,585,'紹介ページを公開する',opacity=ease(local/.4))
        txt(im,'完了した作業と、',117,684,36,INK,True)
        txt(im,'残った作業がわかる。',117,744,36,CORAL,True)
        screen(im,'remaining',local,760,475,1032,294,ease(local/.3))
        pill(im,'親タスクには、残作業あり',1192,818,BRAND,'#efddcf',27)
    return im

def section_diagram(im,t):
    cols=[('遅延',CORAL,['公開前のチェックを確認']),('今日',BRAND,['SNSの投稿文を用意','紹介ページを公開']),('完了',GREEN,['紹介文の構成を考える'])]
    for i,(label,color,items) in enumerate(cols):
        p=ease((t-.35-i*.15)/.65);x=112+i*582;y=426+25*(1-p)
        box(im,x,round(y),548,400,PANEL,28,p)
        pill(im,label,x+27,y+28,color,'#f4e7dc' if i!=2 else '#e8f0e9',35,p)
        for j,item in enumerate(items):
            q=ease((t-.7-i*.15-j*.16)/.55)
            box(im,x+25,round(y+135+j*108),498,86,'#fff9f3',16,q)
            txt(im,item,x+47,y+163+j*108,28,INK,True,q)
    txt(im,'区分のイメージ',1589,910,21,MUTED)

def scene5(t):
    im=base_frame(5,t)
    if t<3:
        reveal(im,'遅延・今日・完了を、ひと目で。',96,212,69,INK,True,t=t)
        section_diagram(im,t)
    elif t<6:
        local=t-3
        reveal(im,'やることを、次々に登録。',96,212,71,INK,True,t=local)
        p=ease(local/.45)
        task_card(im,116,442,820,'SNSの投稿文を用意する',opacity=p)
        task_card(im,116,603,820,'紹介ページを公開する',opacity=ease((local-.65)/.45),accent=True)
        txt(im,'思いついた仕事を、その場でタスクに。',123,833,31,MUTED)
        name='register_one' if local<1.5 else 'register_two'
        screen(im,name,local if local<1.5 else local-1.5,1113,278,605,684)
        pill(im,'実際の連続登録',1530,970,MUTED,'#eee5dc',20)
    else:
        local=t-6
        reveal(im,'大きな仕事は、子タスクに。',96,212,72,INK,True,t=local)
        p=ease(local/.45)
        task_card(im,111,425,760,'紹介ページを公開する',opacity=p)
        d=ImageDraw.Draw(im);d.line((155,539,155,774),fill='#d1b19a',width=4)
        for i,title in enumerate(['Cotaskaの紹介文を作る','公開用の画像を選ぶ']):
            q=ease((local-.4-i*.28)/.55)
            d.line((155,603+i*165,196,603+i*165),fill='#d1b19a',width=4)
            task_card(im,196,552+i*165,675,title,status='完了' if i==0 else '未着',opacity=q,accent=i==0)
        txt(im,'親タスクの関連サブタスク',1011,420,32,BRAND,True)
        screen(im,'remaining',local,997,536,800,228)
        pill(im,'AI作業後の実画面',1510,825,MUTED,'#eee5dc',20)
    return im

TASK_TEXT=(WORK/'Cotaska-Intro/tasks/T-0007/T-0007.md').read_text(encoding='utf-8')
BODY=TASK_TEXT.split('---',2)[2].strip()
def scene6(t):
    im=base_frame(6,t)
    reveal(im,'タスクは、手元のMarkdownに。',96,213,70,INK,True,t=t)
    p=ease((t-.35)/.8)
    task_card(im,113,464,655,'Cotaskaの紹介文を作る',subtitle='目的・完了条件・実施結果',opacity=p,accent=True)
    paste(im,icon('file',77),143,717,p)
    txt(im,'T-0007.md',252,739,36,BRAND,True,p)
    paste(im,icon('arrow',88),822,569,p)
    box(im,1000,378,795,548,BRAND,27,p)
    txt(im,'T-0007.md',1038,410,29,'#f8e6d8',True,p)
    ImageDraw.Draw(im).line((1038,468,1755,468),fill='#81614d',width=2)
    # Selected literal lines of the real task source, not reconstructed app UI.
    lines=['## 目的','Cotaskaの使いやすさを伝える紹介文を作る。','','## 完了条件','- 80〜120文字の日本語紹介文','','## 実施結果','- 91文字の日本語紹介文を作成し、','  results/紹介文.md に保存しました。']
    for i,line in enumerate(lines):
        q=ease((t-.85-i*.06)/.5)
        txt(im,line,1038,506+i*43,27,'#f2c8a7' if line.startswith('##') else '#fff8f2',line.startswith('##'),q)
    txt(im,'実際のMarkdownタスクから抜粋',1423,949,22,MUTED)
    reveal(im,'目的も、仕事の記録も、手元に残る。',115,887,32,MUTED,t=t,delay=1.2)
    return im

def scene7(t):
    im=base_frame(7,t)
    p=ease(t/.75)
    logo=LOGO.resize((400,151),Image.Resampling.LANCZOS)
    paste(im,logo,760,158+25*(1-p),p)
    p1=ease((t-.35)/.7);p2=ease((t-.7)/.7)
    runs(im,[('タスク管理と',INK),('AIチャット',CORAL),('を、',INK)],960,427+25*(1-p1),80,True,p1,True)
    txt(im,'ひとつの作業画面に。',960,548+25*(1-p2),86,INK,True,p2,True)
    p3=ease((t-1.1)/.6)
    box(im,647,726,626,100,BRAND,20,p3)
    txt(im,'公式サイトで詳しく',960,758,35,'#fff8f2',True,p3,True)
    txt(im,'ebisenbei.github.io/cotaska-site/',960,880,35,BRAND,False,p3,True)
    return im

SCENES=[scene0,scene1,scene2,scene3,scene4,scene5,scene6,scene7]
def frame(global_t,transition=True):
    idx=max(i for i,v in enumerate(STARTS[:-1]) if global_t>=v)
    local=global_t-STARTS[idx]
    im=SCENES[idx](local)
    if transition and idx>0 and local<.28:
        # A short paper wipe avoids overlapping two different readable headlines.
        prev=SCENES[idx-1](STARTS[idx]-STARTS[idx-1]-.04)
        width=round(W*ease(local/.28))
        prev.paste(im.crop((0,0,width,H)),(0,0))
        im=prev
    return im.convert('RGB')

def previews():
    global PREVIEW
    PREVIEW=True
    out=ROOT/'qa';out.mkdir(exist_ok=True)
    times=[2.4,5.8,9.5,14.8,18.8,21.7,27.7,31.8,34.7,37.7,40.8,43.7,47.4,51.7,57.8]
    sheet=Image.new('RGB',(1920,5*386),PAPER)
    for i,t in enumerate(times):
        im=frame(t);im.save(out/f'frame-{t:.1f}.jpg',quality=94)
        thumb=im.resize((640,360),Image.Resampling.LANCZOS)
        sheet.paste(thumb,((i%3)*640,(i//3)*386+26))
        ImageDraw.Draw(sheet).text(((i%3)*640+8,(i//3)*386+4),f'{t:.1f}s',font=font(17),fill=INK)
    sheet.save(out/'storyboard-contact.jpg',quality=95)
    print(str(out/'storyboard-contact.jpg'),flush=True)

def render():
    silent=ROOT/'motion-picture.mp4'
    log=(ROOT/'render.log').open('w',encoding='utf-8')
    proc=subprocess.Popen([str(FF),'-hide_banner','-loglevel','warning','-y','-f','rawvideo','-pix_fmt','rgb24','-s','1920x1080','-r','30','-i','-','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-frames:v','1800','-movflags','+faststart',str(silent)],stdin=subprocess.PIPE,stderr=log)
    try:
        for i in range(1800):
            im=frame(i/30)
            proc.stdin.write(im.tobytes())
            if i%150==0:print(f'Rendered {i}/1800 frames ({i/30:.0f}s)',flush=True)
        proc.stdin.close();code=proc.wait()
        if code:raise RuntimeError(f'Encoder failed: {code}')
    finally:
        for reader in READERS.values():reader.close()
        log.close()
    dest=OUT/'Cotaska_紹介動画_モーショングラフィックス_v1_60秒.mp4'
    subprocess.run([str(FF),'-hide_banner','-loglevel','error','-n','-i',str(silent),'-i',str(ROOT/'audio/mix.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-af','loudnorm=I=-16:TP=-1.5:LRA=7','-ar','48000','-t','60','-movflags','+faststart','-metadata','title=Cotaska タスク管理とAIチャットをひとつの作業画面に',str(dest)],check=True)
    subprocess.run([str(FF),'-v','error','-n','-ss','57.8','-i',str(dest),'-frames:v','1','-q:v','2',str(OUT/'Cotaska_紹介動画_モーショングラフィックス_v1_サムネイル.jpg')],check=True)
    print(str(dest),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--preview',action='store_true');args=parser.parse_args()
    previews() if args.preview else render()
