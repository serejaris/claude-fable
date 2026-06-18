# Original prompt (verbatim)

You are a level designer recreating a simplified de_dust (Counter-Strike 1.6) as a low-poly axis-aligned-box arena for a browser FPS. Output strictly per schema. Think hard about flow before emitting boxes.

Coordinate system: X east, Z south (T spawn at positive Z, CT at negative Z), Y up, ground plane y=0. Player: 1.8 tall, 0.8 wide, walks up steps of <=0.5, jumps ~1.3 high.

Arena: 150x150. Perimeter walls REQUIRED: four boxes h=9, thickness 2, centered at x=0,z=-74; x=0,z=74; x=-74,z=0; x=74,z=0 (lengths 150).

Classic dust structure, simplified to boxes:
- T spawn zone south (z 52..66), CT spawn zone north (z -66..-52), both semi-open with low cover
- THREE lanes between them: west = tunnels (narrow corridors, wall height 5-6, width 4-6, at least one bend), center = mid with a "double doors" choke (gap 4-5 wide between wall segments), east = long A (wide lane with a door/arch choke near CT side)
- Bombsite A: raised plateau y=0 h=2 (~22x16) in NE, reachable via explicit stairs (sequences of boxes, each step: d or w = 1.2, h rising +0.5 per step) from long AND from catwalk
- Catwalk: elevated walkway from mid toward A: floor boxes h=2 (so walking surface at y=2), reachable by stairs from mid
- Bombsite B: NW yard enclosed by walls with 2 entrances, crate clusters inside
- 14-18 crates (cubes 2-3 units, some stacked two high) breaking sightlines in lanes and at sites
- NO sightline may run the full 150 units unbroken; every lane needs 2-3 cover points
- corridors min width 4, door gaps 3.5-5

Palette (use EXACTLY these hex strings): walls '#b8995f', stone accents '#a89a78', dark sand structures '#b09a5e', crates '#9b7b48' and '#7e6238', raised plateaus '#c2a96a'.

Also output:
- spawns: 16 points [x, 0, z] — 8 in T zone, 8 in CT zone, each at least 2.5 units from any box and inside walls
- medkits: 6 points [x, z] at CONTESTED spots (mid, near each site, tunnels, long, catwalk approach) — never in spawn zones

Hard limits: max 140 boxes; everything within |x|<=73, |z|<=73; double-check no box overlaps any spawn point; stairs steps listed explicitly as individual boxes. In notes: one paragraph naming the callouts and intended flow.
