import bpy, sys, math
stl,out=sys.argv[1],sys.argv[2]; oblique=len(sys.argv)>3
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.stl_import(filepath=stl); o=bpy.context.object
m=bpy.data.materials.new('r'); m.use_nodes=True; b=m.node_tree.nodes['Principled BSDF']
b.inputs['Base Color'].default_value=(0.62,0.6,0.55,1); b.inputs['Roughness'].default_value=0.55
o.data.materials.append(m)
sc=bpy.context.scene; sc.render.engine='CYCLES'; sc.cycles.samples=64; sc.cycles.device='CPU'
sc.render.resolution_x=sc.render.resolution_y=1000
sc.world=bpy.data.worlds.new('w'); sc.world.use_nodes=True
sc.world.node_tree.nodes['Background'].inputs[0].default_value=(0.18,0.18,0.18,1)
cam=bpy.data.cameras.new('c'); co=bpy.data.objects.new('c',cam); sc.collection.objects.link(co); sc.camera=co
if oblique:
    cam.lens=85; co.location=(0,-95,95); co.rotation_euler=(math.radians(45),0,0)
else:
    cam.type='ORTHO'; cam.ortho_scale=(16 if 'face' in out else 45); co.location=((0,-3.5,60) if 'face' in out else (0,0,60))
for rot,e in [((math.radians(50),0,math.radians(-30)),3.5),((math.radians(60),0,math.radians(150)),0.6)]:
    ld=bpy.data.lights.new('l','SUN'); ld.energy=e; ld.angle=math.radians(8)
    lo=bpy.data.objects.new('l',ld); sc.collection.objects.link(lo); lo.rotation_euler=rot
sc.render.filepath=out; bpy.ops.render.render(write_still=True)
