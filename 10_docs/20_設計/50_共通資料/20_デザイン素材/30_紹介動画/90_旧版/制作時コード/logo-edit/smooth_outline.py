"""Regularize only the white silhouette, keeping the original artwork pixels."""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image,ImageFilter,ImageDraw,ImageFont

root=Path(__file__).resolve().parent
repo=root.parents[2]
folder=repo/'Cotaska/10_docs/20_設計/50_共通資料/20_デザイン素材/10_ロゴ案'
source=folder/'Cotaskaロゴ_案01.png'
previous=folder/'Cotaskaロゴ_案01_背景透過_白縁20px.png'
output=folder/'Cotaskaロゴ_案01_背景透過_白縁20px_輪郭調整.png'
if output.exists():raise RuntimeError('Preserve existing output; choose another filename.')
source_sha=hashlib.sha256(source.read_bytes()).hexdigest()
previous_sha=hashlib.sha256(previous.read_bytes()).hexdigest()
old=Image.open(previous).convert('RGBA')
old_a=np.array(old.getchannel('A'))
binary=Image.fromarray(np.uint8(old_a>=128)*255)
scale=4
# Smooth the silhouette's small pixel-sized bumps, then restore a crisp contour.
# Supersampling provides coverage antialiasing rather than a fuzzy blurred border.
large=binary.resize((old.width*scale,old.height*scale),Image.Resampling.BICUBIC)
large=large.filter(ImageFilter.GaussianBlur(2.8*scale))
large=large.point(lambda v:255 if v>=128 else 0)
alpha=large.resize(old.size,Image.Resampling.BOX)
a=np.array(alpha)
rgb=np.array(Image.open(source).convert('RGB'))
foreground=rgb.min(axis=2)<245
rgba=np.full((old.height,old.width,4),255,dtype=np.uint8)
rgba[:,:,:3][foreground]=rgb[foreground]
a[foreground]=255
rgba[:,:,3]=a
result=Image.fromarray(rgba,'RGBA')
result.save(output,optimize=True)

qa=root/'qa';qa.mkdir(exist_ok=True)
for name,color in [('dark','#2d241f'),('light','#e8e8e8')]:
    bg=Image.new('RGBA',result.size,color)
    Image.alpha_composite(bg,result).convert('RGB').save(qa/f'logo-smooth-{name}.png')

crop=(500,285,1140,630)
comparison=Image.new('RGB',(1280,2*730),'#2d241f')
draw=ImageDraw.Draw(comparison)
f=ImageFont.truetype('C:/Windows/Fonts/YuGothM.ttc',24)
for i,(label,im) in enumerate([('調整前',old),('輪郭調整後',result)]):
    bg=Image.new('RGBA',im.size,'#2d241f')
    close=Image.alpha_composite(bg,im).convert('RGB').crop(crop).resize((1280,690),Image.Resampling.NEAREST)
    comparison.paste(close,(0,i*730+40))
    draw.text((14,i*730+5),label,font=f,fill='white')
comparison.save(qa/'outline-before-after.png')

old_mask=old_a>=128;new_mask=a>=128
iou=float(np.logical_and(old_mask,new_mask).sum()/np.logical_or(old_mask,new_mask).sum())
assert iou>.99,'Silhouette changed too much; preserve approved outline width.'
assert np.array_equal(rgba[:,:,:3][foreground],rgb[foreground])
assert result.size==old.size and result.mode=='RGBA'
assert a[0,:].max()==0 and a[-1,:].max()==0 and a[:,0].max()==0 and a[:,-1].max()==0
assert hashlib.sha256(source.read_bytes()).hexdigest()==source_sha
assert hashlib.sha256(previous.read_bytes()).hexdigest()==previous_sha
report={'output':str(output),'size':list(result.size),'mode':'RGBA','nominal_outline_px':20,'supersampling':scale,'silhouette_regularization_radius_px':2.8,'previous_silhouette_iou':iou,'source_sha256':source_sha,'previous_sha256':previous_sha,'output_sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'colored_pixels_preserved':int(foreground.sum()),'alpha_extrema':[int(a.min()),int(a.max())]}
(root/'smooth-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
