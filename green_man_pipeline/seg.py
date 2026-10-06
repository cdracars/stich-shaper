import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
from skimage import filters, segmentation, morphology, measure
src='source.png'
im=Image.open(src).convert('RGBA'); bg=Image.new('RGBA',im.size,(0,0,0,255)); bg.alpha_composite(im)
g=np.asarray(bg.convert('L'),float); mask=g>40
cols=np.nonzero(mask.sum(0)>200)[0]; rows=np.nonzero(mask.sum(1)>200)[0]
cx,cy=(cols.min()+cols.max())/2,(rows.min()+rows.max())/2; r=min(np.ptp(cols),np.ptp(rows))/2
N=1200
G=np.asarray(Image.fromarray(g.astype(np.uint8)).crop((int(cx-r),int(cy-r),int(cx+r),int(cy+r))).resize((N,N),Image.LANCZOS),float)
np.save('G1200.npy',G)
sm=ndi.gaussian_filter(G,1.5)
# dark lines / gaps: darker than local surroundings
loc=ndi.gaussian_filter(G,12)
line=(sm<loc-9)|(sm<95)
line=morphology.remove_small_objects(line,40)
reg=~line
reg=morphology.binary_opening(reg,morphology.disk(2))
lab=measure.label(reg,connectivity=1)
lab=morphology.remove_small_objects(lab,300)
lab,_,_=segmentation.relabel_sequential(lab)
# grow labels into line pixels
dist,(ii,jj)=ndi.distance_transform_edt(lab==0,return_indices=True)
full=lab[ii,jj]
ii0,jj0=np.mgrid[0:N,0:N]; rr=np.hypot(ii0-(N-1)/2,jj0-(N-1)/2)/((N-1)/2)
full[rr>0.985]=0
np.save('lab.npy',full); np.save('dark.npy',(sm<95))
n=full.max(); print('regions',n)
rng=np.random.default_rng(1); pal=(rng.random((n+1,3))*180+60).astype(np.uint8); pal[0]=0
ov=(0.45*pal[full]+0.55*np.stack([G]*3,-1)).astype(np.uint8)
b=segmentation.find_boundaries(full); ov[b]=(0,0,0)
img=Image.fromarray(ov); d=ImageDraw.Draw(img)
try: f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',15)
except: f=ImageFont.load_default()
for p in measure.regionprops(full):
    y,x=p.coords[np.argmax(ndi.distance_transform_edt(np.pad(p.image,1))[1:-1,1:-1][p.image])]
    d.text((x-8,y-8),str(p.label),fill=(255,255,0),font=f,stroke_width=2,stroke_fill=(0,0,0))
img.save('labels.png')
