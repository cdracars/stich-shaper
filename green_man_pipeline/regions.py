import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage import segmentation, morphology, measure
exec(open('seeds.py').read())
G=np.load('G1200.npy'); N=G.shape[0]
names=list(E)
ii,jj=np.mgrid[0:N,0:N]; c=(N-1)/2; rr=np.hypot(ii-c,jj-c)/c
sm=ndi.gaussian_filter(G,1.5)
mk=Image.new('I',(N,N),0); d=ImageDraw.Draw(mk)
for k,n in enumerate(names,1):
    for pl in E[n][1]:
        for flip in (False,True):
            p=[(N-1-x,y) if flip else (x,y) for x,y in pl]
            d.line(p,fill=k,width=7)
M=np.asarray(mk,np.int32).copy()
PLATE,GAP=len(names)+1,len(names)+2
grad=ndi.gaussian_gradient_magnitude(G,1.8)
plate_gray=np.median(sm[(rr>0.9)&(rr<0.97)])
flat=(grad<2.6)&(np.abs(sm-plate_gray)<16)
lab,_=ndi.label(flat); ids=np.unique(lab[(rr>0.9)&(rr<0.97)&flat]); ids=ids[ids>0]
plate=ndi.binary_erosion(np.isin(lab,ids),iterations=4)|((rr>0.94)&(rr<0.985))
face=(((jj-600)/175)**2+((ii-700)/235)**2)<1
gap=ndi.binary_erosion((sm<84)&~face,iterations=3)
gap=morphology.remove_small_objects(gap,max_size=60)
M[(M==0)&plate]=PLATE; M[(M==0)&gap]=GAP
W=segmentation.watershed(grad,M,mask=rr<0.985)
np.save('W.npy',W)
import json; json.dump({'names':names,'PLATE':PLATE,'GAP':GAP},open('W.json','w'))
rng=np.random.default_rng(3); pal=(rng.random((GAP+1,3))*200+40).astype(np.uint8); pal[0]=0; pal[PLATE]=(60,60,60); pal[GAP]=(0,0,0)
ov=(0.5*pal[W]+0.5*np.stack([G]*3,-1)).astype(np.uint8); ov[segmentation.find_boundaries(W)]=(255,255,0)
Image.fromarray(ov).save('W.png')
for k,n in enumerate(names,1): print(n,(W==k).sum())
