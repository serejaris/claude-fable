import json, math

WALL='#b8995f'; STONE='#a89a78'; DARK='#b09a5e'; CR_A='#9b7b48'; CR_B='#7e6238'; PLAT='#c2a96a'

B=[]
def box(name,x,z,w,h,d,c,y=0):
    B.append(dict(name=name,x=x,z=z,w=w,h=h,d=d,c=c,y=y))

# perimeter (required spec, exempt from |73| interior rule)
box('perimN',0,-74,150,9,2,WALL); box('perimS',0,74,150,9,2,WALL)
box('perimW',-74,0,2,9,150,WALL); box('perimE',74,0,2,9,150,WALL)

# core structures
box('WBLOCK',-36,14,36,6,76,DARK)          # x -54..-18, z -24..52 (mid west building)
box('MB',22,14,8,6,64,WALL)                # x 18..26, z -18..46 (mid/long divider)
box('doorL',-10.125,-8,15.75,6,3,WALL)     # double doors left  (gap x -2.25..2.25)
box('doorR',10.125,-8,15.75,6,3,WALL)      # double doors right
box('tunS',-45.5,58.5,55,5,3,STONE)        # tunnel south wall x -73..-18
box('tunE',-55.5,13,3,5,78,STONE)          # tunnel east wall z -26..52
box('tunW',-63.5,16,3,5,88,STONE)          # tunnel west wall z -28..60
box('bSouthW',-67.5,-26.5,11,6,3,WALL)     # B south wall x -73..-62
box('bSouthE',-43.5,-26.5,27,6,3,WALL)     # B south wall x -57..-30 (gap -62..-57 = tunnels)
box('bEastN',-30,-64.75,3,6,16.5,WALL)     # B east wall z -73..-56.5
box('bEastS',-30,-37.5,3,6,29,WALL)        # B east wall z -52..-23 (gap -56.5..-52)
box('LB1',64,36,12,6,16,DARK)              # long building x 58..70
box('longDoorW',46.5,-26,11,6,3,WALL)      # x 41..52
box('longDoorE',64.75,-26,16.5,6,3,WALL)   # x 56.5..73 (gap 52..56.5)
box('plateauA',51,-48,22,2,16,PLAT)        # A site x 40..62, z -56..-40
box('cat1',27.5,-20,27,2,4,PLAT)           # catwalk x 14..41
box('cat2',38,-30,6,2,24,PLAT)             # catwalk x 35..41, z -42..-18

# stairs mid->catwalk (z=-20, d=4, w=1.2 each, +0.5 rise)
for i,(x,h) in enumerate([(9.8,.5),(11.0,1.0),(12.2,1.5),(13.4,2.0)]):
    box(f'stMid{i+1}',x,-20,1.2,h,4,STONE)
# stairs long->A (x=51, w=6, d=1.2)
for i,(z,h) in enumerate([(-35.8,.5),(-37.0,1.0),(-38.2,1.5),(-39.4,2.0)]):
    box(f'stLong{i+1}',51,z,6,h,1.2,STONE)
# stairs CT->A north face (x=45, w=6, d=1.2)
for i,(z,h) in enumerate([(-60.2,.5),(-59.0,1.0),(-57.8,1.5),(-56.6,2.0)]):
    box(f'stCT{i+1}',45,z,6,h,1.2,STONE)

# low cover in spawn zones
box('lcT1',4,51,10,1.2,1.5,STONE); box('lcT2',22,53,6,1.2,1.5,STONE)
box('lcCT1',4,-51,10,1.2,1.5,STONE); box('lcCT2',-10,-53,6,1.2,1.5,STONE)

# stone blocks (sightline breakers)
box('sb1',30,-69,3,2.5,3,STONE)
box('sb2',-24,-34,2.5,2.5,2.5,STONE)
box('sb3',29,30,2.5,2.5,2.5,STONE)
box('sb4',-20,68,3,3,3,STONE)
box('sb5',22,71,3,3,3,STONE)
box('sb6',10,-66,2.5,2.5,2.5,STONE)
box('sb7',34,-61,2.8,2.8,2.8,STONE)
box('sb8',-2,65,3,3,3,STONE)
box('sb9',20,55.3,2.8,2.8,3.4,STONE)
box('sb10',26,61.5,3,3,4,STONE)

# crates (14-18, cubes 2-3, some stacked)
crates=[('cr1',-6,32,2.5,CR_A,0),('cr2',-6,32,2.5,CR_B,2.5),
('cr3',8,14,3,CR_A,0),('cr4',0.9,-31,3,CR_B,0),('cr5',-1.8,-20,2.5,CR_A,0),
('cr6',16,53,2.8,CR_A,0),('cr7',45,22,2.8,CR_A,0),('cr8',45,22,2.8,CR_B,2.8),
('cr9',71.2,12,3,CR_A,0),('cr10',52,-12,2.5,CR_A,0),
('cr11',46,-50,2.5,CR_A,2),('cr12',57,-44,2.5,CR_B,2),
('cr13',-56,-48,3,CR_A,0),('cr14',-56,-48,3,CR_B,3),
('cr15',-42,-60,2.5,CR_A,0),('cr16',-45,-54,2.5,CR_B,0),
('cr17',-58.5,10,2.5,CR_B,0),('cr18',-60.5,-8,2.5,CR_A,0)]
for n,x,z,s,c,y in crates: box(n,x,z,s,s,s,c,y)

spawns_T=[(-14,0,56),(-5,0,56),(4,0,56),(12,0,57),(24,0,57),(-10,0,62),(8,0,62),(17,0,62)]
spawns_CT=[(-12,0,-62),(-6,0,-62),(0,0,-62),(6,0,-62),(12,0,-62),(-9,0,-57),(3,0,-57),(15,0,-57)]
spawns=spawns_T+spawns_CT
medkits=[(0,-2),(8,-15),(-50,-44),(52,-31),(62,-8),(-59.5,35)]

errs=[]; warns=[]

# counts / palette
print(f'boxes={len(B)} (limit 140), crates={len(crates)}')
if not 14<=len(crates)<=18: errs.append('crate count')
pal={WALL,STONE,DARK,CR_A,CR_B,PLAT}
for b in B:
    if b['c'] not in pal: errs.append(f"palette {b['name']}")

# bounds (perimeter exempt)
for b in B:
    if b['name'].startswith('perim'): continue
    if abs(b['x'])+b['w']/2>73+1e-9 or abs(b['z'])+b['d']/2>73+1e-9:
        errs.append(f"bounds {b['name']}")

def dist_pt_box(px,pz,b):
    dx=max(b['x']-b['w']/2-px, 0, px-(b['x']+b['w']/2))
    dz=max(b['z']-b['d']/2-pz, 0, pz-(b['z']+b['d']/2))
    return math.hypot(dx,dz)

# spawn clearance >= 2.5 from any box (2D), and inside zones
for sx,_,sz in spawns:
    for b in B:
        d=dist_pt_box(sx,sz,b)
        if d<2.5: errs.append(f'spawn ({sx},{sz}) too close to {b["name"]} d={d:.2f}')
for sx,_,sz in spawns_T:
    if not(52<=sz<=66): errs.append(f'T spawn zone ({sx},{sz})')
for sx,_,sz in spawns_CT:
    if not(-66<=sz<=-52): errs.append(f'CT spawn zone ({sx},{sz})')

# medkits: not inside any box footprint at ground (allow on plateau? we keep them off boxes), not in spawn zones
for mx,mz in medkits:
    for b in B:
        if b['y']==0 and dist_pt_box(mx,mz,b)==0:
            errs.append(f'medkit ({mx},{mz}) inside {b["name"]}')
    if 52<=mz<=66 or -66<=mz<=-52:
        if -30<mx<30: errs.append(f'medkit ({mx},{mz}) in spawn zone')

# sightline scan at eye 1.7: rows (fixed z) and columns (fixed x)
def blockers_eye():
    return [b for b in B if b['y']==0 and b['h']>=1.7 and not b['name'].startswith('perim')]
BL=blockers_eye()
def max_run(fixed,axis):
    iv=[]
    for b in BL:
        if axis=='row':  # fixed z, intervals in x
            if b['z']-b['d']/2<=fixed<=b['z']+b['d']/2: iv.append((b['x']-b['w']/2,b['x']+b['w']/2))
        else:
            if b['x']-b['w']/2<=fixed<=b['x']+b['w']/2: iv.append((b['z']-b['d']/2,b['z']+b['d']/2))
    iv.sort(); lo=-73; best=0;
    for a,bnd in iv+[(73,73)]:
        if a>lo: best=max(best,a-lo)
        lo=max(lo,bnd)
    return best
worst=[]
import numpy as np
for v in np.arange(-72.5,73,0.5):
    r=max_run(v,'row');  c=max_run(v,'col')
    if r>130: worst.append(('row',float(v),r))
    if c>130: worst.append(('col',float(v),c))
print('runs>130:',worst if worst else 'none')
mx=0; arg=None
for v in np.arange(-72.5,73,0.5):
    for k in ('row','col'):
        r=max_run(v,k)
        if r>mx: mx, arg = r,(k,float(v))
print(f'max unbroken run anywhere: {mx:.1f} at {arg}')

# door gap sanity
print('double-doors gap:', (10.125-15.75/2)-(-10.125+15.75/2))
print('long door gap:', (64.75-16.5/2)-(46.5+11/2))
print('B east gap:', -52-(-56.5))
print('tunnel->B gap:', -57-(-62))

print('ERRORS:', errs if errs else 'none')
print('WARNINGS:', warns if warns else 'none')

out=dict(
 boxes=[{k:v for k,v in b.items() if k!='name' and not(k=='y' and v==0)} for b in B],
 spawns=[list(s) for s in spawns],
 medkits=[list(m) for m in medkits])
with open('/Users/ris/Documents/GitHub/claude-fable/de-dust-boxes/map.json','w') as f:
    json.dump(out,f,indent=1)
print('boxes emitted:',len(out['boxes']))
