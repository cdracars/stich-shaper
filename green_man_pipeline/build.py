import numpy as np, sys
from PIL import Image
H=np.load(sys.argv[1]); out=sys.argv[2]; N=int(sys.argv[3]); DIAM=42.0; BASE=1.5
Hs=np.asarray(Image.fromarray(H.astype(np.float32),mode='F').resize((N,N),Image.LANCZOS),float)
ii,jj=np.mgrid[0:N,0:N]; c=(N-1)/2; inside=np.hypot(ii-c,jj-c)/c<=0.985
z=np.where(inside,BASE+np.clip(Hs,-1.0,None),0.0); s=DIAM/(N-1)
V=np.stack([(jj-c)*s,-(ii-c)*s,z],-1); B=V.copy(); B[...,2]=0
F=inside[:-1,:-1]&inside[1:,:-1]&inside[:-1,1:]&inside[1:,1:]; I,J=np.nonzero(F)
at=lambda A,di,dj:A[I+di,J+dj]
pa,pb,pc,pd=[at(V,*q) for q in ((0,0),(1,0),(1,1),(0,1))]
T=[np.stack([pa,pb,pc],1),np.stack([pa,pc,pd],1)]
pad=np.pad(F,1); nb=lambda di,dj:pad[I+1+di,J+1+dj]
for p,q,m in [((0,0),(1,0),~nb(0,-1)),((1,0),(1,1),~nb(1,0)),((1,1),(0,1),~nb(0,1)),((0,1),(0,0),~nb(-1,0))]:
    Pp,Pq,Bp,Bq=at(V,*p)[m],at(V,*q)[m],at(B,*p)[m],at(B,*q)[m]
    T+=[np.stack([Pp,Bp,Bq],1),np.stack([Pp,Bq,Pq],1),np.stack([np.zeros_like(Bp),Bq,Bp],1)]
T=np.concatenate(T).astype(np.float32)
n=np.cross(T[:,1]-T[:,0],T[:,2]-T[:,0]); ln=np.linalg.norm(n,axis=1,keepdims=True); n=n/np.maximum(ln,1e-12)
vol=np.sum(T[:,0].astype(float)*np.cross(T[:,1],T[:,2]))/6
q=np.round(T/(s/4)).astype(np.int64); Ed=np.sort(np.concatenate([q[:,[0,1]],q[:,[1,2]],q[:,[2,0]]]),axis=1).reshape(-1,6)
_,cnt=np.unique(Ed,axis=0,return_counts=True)
print('tris',len(T),'vol',round(vol,1),'min z',round(float(z[inside].min()),2),'max z',round(float(z.max()),2),'degenerate',int((ln<1e-12).sum()),'edge counts',set(cnt.tolist()))
rec=np.zeros(len(T),dtype=[('n','<f4',3),('v','<f4',(3,3)),('a','<u2')]); rec['n']=n; rec['v']=T
open(out,'wb').write(b'green man 42mm layered'.ljust(80,b'\0')+np.uint32(len(T)).tobytes()+rec.tobytes())
