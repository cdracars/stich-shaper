import numpy as np, json, sys
from scipy import ndimage as ndi
from PIL import Image
exec(open('seeds.py').read())
E['top_leaf']=(1.75,E['top_leaf'][1]); E['nose']=(1.6,E['nose'][1])
G=np.load('G1200.npy'); W=np.load('W.npy'); meta=json.load(open('W.json')); names=meta['names']
N=G.shape[0]; ii,jj=np.mgrid[0:N,0:N]
R={'side_outer':26,'side_inner':26,'top_leaf':28,'antler':34,'face':60,'nose':34,'brow':16,'acorn':18,'mustache':18,'beard_leaf':18,'bottom_leaf':24,'mouth':10,'chin':26}
lev=np.zeros(N*N).reshape(N,N); Rm=np.ones((N,N))*10
for k,n in enumerate(names,1):
    lev[W==k]=E[n][0]; Rm[W==k]=R[n]
lev[W==meta['GAP']]=-0.4; lev[W==meta['PLATE']]=0.0
inside=W>0
# per-pixel: distance to nearest lower-level pixel, and that level
H=np.zeros((N,N)); P=np.zeros((N,N))
for L in np.unique(lev[inside]):
    sel=(lev==L)&inside
    lower=(lev<L)|~inside
    if not lower.any(): H[sel]=L; P[sel]=1; continue
    D,(a,b)=ndi.distance_transform_edt(~lower,return_indices=True)
    Llow=np.where(inside[a,b],lev[a,b],0.0)
    t=np.clip(D/Rm,0,1); p=0.12+0.88*np.sin(t*np.pi/2)
    H[sel]=(Llow+(L-Llow)*p)[sel]; P[sel]=t[sel]
# shapes
face=W==names.index('face')+1
dome=np.clip(1-((jj-600)/190)**2-((ii-690)/240)**2,0,1)
H+=np.where(face|(W==names.index('nose')+1)|(W==names.index('brow')+1),0.45*dome,0)
nose=W==names.index('nose')+1
t=np.clip((ii-600)/170,0,1); w=14+34*t; dx=np.abs(jj-599.5)
ridge=np.where((ii>585)&(ii<790)&(dx<w),(0.25+0.75*t**0.7)*np.clip(1-(dx/w)**2,0,1)**0.6,0)
tip=np.clip(1-((jj-599.5)/36)**2-((ii-762)/30)**2,0,1)**0.5
ridge=np.maximum(ridge,1.05*tip)
H+=np.where((W==names.index('face')+1)|nose,1.0*ridge,0)
# sculpted facial features (left side, mirrored)
fz=(W==names.index('face')+1)|(W==names.index('nose')+1)
def blob(cx,cy,rx,ry,amp,pw=1.0):
    out=np.zeros((N,N))
    for x in (cx,N-1-cx):
        q=np.clip(1-((jj-x)/rx)**2-((ii-cy)/ry)**2,0,1)**pw
        out+=amp*q
    return out
feat=blob(510,632,62,40,-0.35,0.7)      # eye socket
feat+=blob(510,630,26,19,0.55,0.5)      # eyeball
lid=blob(510,624,36,24,1,1.0); lid=np.clip(lid,0,None)
ring=np.clip(lid*4,0,1)-np.clip(blob(510,630,26,19,1,1.0)*6,0,1)
feat+=0.22*np.clip(ring,0,1)*(ii<640)       # upper lid
feat+=blob(511,629,7,7,-0.45,0.4)       # drilled pupil
feat+=blob(495,725,62,72,0.30,1.2)      # cheekbone/cheek
feat+=blob(560,590,80,26,0.18,1.0)      # brow ridge
feat+=blob(565,772,22,20,0.22,0.6)      # nostril wing
feat+=blob(520,680,40,18,0.10,1.0)      # under-eye bag
H+=np.where(fz,feat,0)
# surface detail from the drawing (only on raised elements, faded at edges)
mid=(ndi.gaussian_filter(G,3)-ndi.gaussian_filter(G,22))/255
fine=(G-ndi.gaussian_filter(G,2.5))/255
el=(W>0)&(W<=len(names))
amp=np.where(fz,0.45,1.1)
H+=np.where(el,(amp*mid+0.45*fine)*np.clip(P*1.5,0,1),0)
H=ndi.gaussian_filter(H,1.5)*1.25
H[~inside]=0
np.save('H.npy',H); print('H range',H[inside].min(),H.max())
v=(H-H.min())/(H.max()-H.min()); Image.fromarray((v*255).astype(np.uint8)).save('H.png')
