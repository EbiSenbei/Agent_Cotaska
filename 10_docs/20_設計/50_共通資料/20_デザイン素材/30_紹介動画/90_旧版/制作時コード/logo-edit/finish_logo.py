"""Remove the white paper and add a clean, wider white outline without redrawing."""
from pathlib import Path
import hashlib
import json
import math
import numpy as np
from PIL import Image,ImageFilter

root=Path(__file__).resolve().parent
repo=root.parents[2]
folder=repo/'Cotaska/10_docs/20_設計/50_共通資料/20_デザイン素材/10_ロゴ案'
source=folder/'Cotaskaロゴ_案01.png'
output=folder/'Cotaskaロゴ_案01_背景透過_白縁20px.png'
if output.exists():raise RuntimeError('Output already exists; preserve it.')
sha=hashlib.sha256(source.read_bytes()).hexdigest()
rgb=np.array(Image.open(source).convert('RGB'))
h,w=rgb.shape[:2]
# The paper is 253–255 in all channels, whereas the colored artwork is well below it.
# Keep all original colored and antialiased foreground pixels verbatim.
foreground=rgb.min(axis=2)<245
radius=20

# Exact circular binary dilation. Prefix sums provide fast horizontal intervals;
# the union of shifted intervals gives a disk rather than a square corner.
prefix=np.pad(np.cumsum(foreground,axis=1,dtype=np.int32),((0,0),(1,0)))
xs=np.arange(w)
horizontal={}
grown=np.zeros_like(foreground)
for dy in range(-radius,radius+1):
    dx=math.floor(math.sqrt(radius*radius-dy*dy))
    if dx not in horizontal:
        left=np.maximum(xs-dx,0)
        right=np.minimum(xs+dx+1,w)
        horizontal[dx]=(prefix[:,right]-prefix[:,left])>0
    mask=horizontal[dx]
    if dy<0:grown[:h+dy]|=mask[-dy:]
    elif dy>0:grown[dy:]|=mask[:h-dy]
    else:grown|=mask

# Subpixel smoothing is confined to the outside white outline; source artwork stays intact.
alpha=Image.fromarray(np.uint8(grown)*255).filter(ImageFilter.GaussianBlur(.55))
a=np.array(alpha)
a[foreground]=255
rgba=np.full((h,w,4),255,dtype=np.uint8)
rgba[:,:,:3][foreground]=rgb[foreground]
rgba[:,:,3]=a
im=Image.fromarray(rgba,'RGBA')
im.save(output,optimize=True)

qa=root/'qa';qa.mkdir(exist_ok=True)
for name,color in [('dark','#2d241f'),('light','#e8e8e8')]:
    bg=Image.new('RGBA',im.size,color)
    preview=Image.alpha_composite(bg,im).convert('RGB')
    preview.save(qa/f'logo-{name}.png')

assert im.mode=='RGBA' and im.size==(1805,871)
assert np.array_equal(rgba[:,:,:3][foreground],rgb[foreground])
assert a[0,:].max()==0 and a[-1,:].max()==0 and a[:,0].max()==0 and a[:,-1].max()==0
assert a.min()==0 and a.max()==255
assert hashlib.sha256(source.read_bytes()).hexdigest()==sha
report={'source':str(source),'output':str(output),'size':[w,h],'mode':'RGBA','outline_radius_px':radius,'source_sha256':sha,'output_sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'foreground_pixels_preserved':int(foreground.sum()),'transparent_pixels':int((a==0).sum()),'alpha_extrema':[int(a.min()),int(a.max())],'source_unchanged':True}
(root/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
