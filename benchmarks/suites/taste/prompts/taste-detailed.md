# Tiny World: A Light in the Blue Forest

## Creative objective

Create a beautiful, playable winter diorama: a lonely timber cabin offering warmth inside a cold blue forest. Snow covers uneven ground and branches; dark water moves between shelves of ice; mist hangs in the hollows. A small traveler can explore and enter the cabin. An optional fox or second quiet character adds life.

Aim for finely crafted voxel geometry photographed with realistic materials, lighting, atmosphere, and a wide-angle perspective. The emotional center is shelter: a warm light worth walking toward. Make the opening image compelling and entering delightful. Favor artistic judgment over more objects or effects.

## Deliverable and execution

Return only one complete index.html with inline CSS and JavaScript modules. No Markdown fences, explanation, placeholders, or unfinished sections. It must run over localhost or HTTPS without a build step. Make all decisions in this single response; do not ask questions or call tools, including browsers, terminals, MCP servers, Blender, or image generators.

Use Three.js 0.180.0 throughout, with WebGPURenderer imported from three/webgpu and its WebGL2 fallback allowed. Pin all imports and addons to that release through a consistent CDN import map. Initialize the renderer before rendering. Use compatible materials and TSL/node-based effects where needed, not WebGL-only shader or postprocessing pipelines.

Generate all geometry, materials, textures, and animation in code; procedural canvas or data textures are allowed. External requests may load only pinned Three.js modules and their dependencies, not models, images, HDR environments, fonts, audio, or scene assets. Build real 3D, not a flat image or prerecorded sequence.

## Composition and scale

Build a compact landscape with an irregular, finished edge and visible terrain thickness, like a collectible miniature. Use a muted backdrop and elevation changes that create depth without frustrating navigation.

Place the cabin off-center, backed by taller trees. Open the foreground with a stream or partially frozen pond. Provide a readable route to the door, adding a bridge if useful. Balance dense forest against quiet stretches of snow and water. Do not hide the cabin, traveler, or entrance behind decorative trees. Maintain coherent scale between doors, furniture, steps, trees, and characters.

## Voxel art language

Build terrain, architecture, vegetation, props, and characters from crisp, grid-conscious forms with stepped silhouettes. Use finer detail for roofs, branches, windows, and faces than for larger masses. Use instancing or merged surfaces, not a separate object per cube.

Avoid both oversized primitive blocks and noisy voxel confetti. Establish coherent masses before adding purposeful variation and selected details. Water, fog, and light may be smooth; they should complement the voxel geometry. Aim for a crafted miniature, not generic block-world scenery.

## Terrain, snow, and paths

Shape gentle terraces, banks, hollows, and a sheltered cabin foundation. Expose dark rock or earth sparingly along steep edges and the waterline. Give snow depth through stepped drifts, overhanging caps, accumulated pockets, and compressed patches near traveled areas.

Snow should rest on upward-facing surfaces and gather around obstacles, not coat every vertical face. Use ivory, pale blue, lavender, and gray variation that follows form and light, not random colors per cube. Use dark crevices for weight. Define a traversable route with compressed snow, footprints, or warm light. New traveler footprints are optional.

## The blue forest

Create related but varied winter trees: different heights, trunk leans, branches, crown widths, and snow coverage. Build branching structures and clustered snow-laden foliage rather than identical stacked cones. Let dark trunks and shaded gaps show through the blue-white canopy.

Group trees around openings. Use taller trees for enclosure and foreground growth for framing. Selectively add frosted shrubs, roots, stumps, or bent reeds. Preserve negative space instead of distributing objects uniformly. Suggest forest depth without building an enormous world.

## Cabin exterior

Make the cabin the visual anchor: a distinctive, believable timber silhouette, thick snowy roof, visible eaves, recessed windows, chimney, and small porch or entrance. Suggest weathered wood through geometry and controlled tonal variation. Choose supporting firewood, a lantern, railings, or icicles without clutter.

Warm window light should reach nearby snow. Keep window frames legible rather than lost in bloom. The entrance must be a real opening sized for the traveler. Use an open or automatically opening door. No fake facade or empty box.

## Furnished interior

Build an actual room within the cabin footprint: wooden floor, hearth or stove, table, seating, and a resting area. Choose a few telling details such as a mug, folded blanket, shelf, boots, or wood basket. Arrange a usable room with a clear walking path, not a checklist crammed into every corner.

Give it warm local lighting and distinguish worn wood, dark metal, fabric, and stone. Retain the voxel style. Reward inspection. Do not load a separate scene or let weather pass through the roof.

## Water and ice

Show visibly liquid water and visibly solid ice. Dark water occupies a coherent channel or pool, with gentle motion, subtle ripples, and plausible highlights. Reflect or convincingly suggest the sky, trees, and cabin light without making a perfect mirror. Use compatible approximations where needed for reliability.

Give ice thickness, frosted rims, restrained blue-green translucency or opacity variation, and a few cracks or trapped pale details. Shape snow-covered banks and overhanging shelves around exposed water. Distinguish snow, ice, and liquid; do not substitute a flat cyan plane.

## Lighting and atmosphere

Set blue hour: cool blue and violet-gray forest, with the cabin softly glowing amber. Preserve enough ambient illumination to read terrain and trees. Use coherent cool directional light and localized warm sources, with soft-looking shadows and contact shading that ground objects.

Differentiate powdery matte snow, rough timber, dark stone, glossy water, and smoother ice. Use physically based shading, sensible tone mapping, and restrained exposure. Approximate bounce light where useful while keeping it spatially believable. Avoid excessive ambient light, uniform plastic materials, or nearly black shadows.

Add low drifting mist near water and distant tree groups, plus sparse falling snow. Keep the route and cabin readable. Avoid opaque fog cards and obvious particle walls. A thin chimney plume and subtle fire flicker can suggest life. Bloom should support lighting, never wash out windows or conceal weak geometry.

## Camera and photographic finish

Use elevated three-quarter perspective with a moderately wide vertical field of view, approximately 55 to 70 degrees. Initially frame the whole diorama with breathing room while keeping the cabin and traveler recognizable. Do not use an orthographic camera or extreme fisheye distortion.

Allow mouse-drag orbit and wheel zoom within sensible limits. Prevent camera clipping and views dominated by the terrain underside. During movement, follow gently when needed while preserving the miniature composition. Avoid automatic spinning, camera shake, and abrupt reframing.

A restrained, genuinely depth-aware depth-of-field effect is optional. Keep the entrance and active traveler in focus; never blur the entire canvas or make navigation unreadable. Prefer a clean image over heavy grain, vignetting, chromatic aberration, or lens flare. The scene must work from multiple viewpoints, not just one staged screenshot.

## Characters and movement

Make a recognizable voxel traveler with a winter coat or cloak, readable limbs, and one controlled warm accent. Keep it distinct against snow. Add idle motion, a walking cycle, and smooth facing changes. An optional fox or second figure watches quietly.

W/A/S/D must move the traveler, not just the camera. Use camera-relative ground movement, normalized diagonals, frame-rate-independent updates, and responsive stopping. Follow terrain height and traverse small steps; keep feet grounded.

Collide with cabin walls, major trunks, rocks, and furniture. Block open water and steep terrain with boundaries matching visible geometry; designated solid ice may be walkable. Ensure an unobstructed route from spawn through the door and around the room. Prevent falling off the diorama, walking through walls, and getting trapped at the threshold. Reset held keys on focus loss.

## Cabin cutaway transition

Crossing the doorway must seamlessly reveal a dollhouse-style cutaway of the same cabin. Smoothly hide or fade the roof and upper walls obstructing the camera while retaining floors, furniture, and useful wall portions. Preserve the surrounding world and keep movement active.

Do not teleport the traveler, display a menu, or load a separate room. Hidden walls retain appropriate collisions; the doorway remains the way in and out. Manage the removed roof's shadow so the interior does not stay inexplicably dark. Use interior bounds with a threshold margin to prevent flickering at the entrance. Restore the exterior smoothly on exit. Do not simply hide the entire house.

## Presentation and implementation quality

Show the finished world after initialization with only a small hint for WASD, orbit, zoom, and R to reset. R restores the traveler, camera, and exterior state. Avoid title screens, large panels, debug helpers, and scoreboards. Handle resizing and show a readable error if graphics initialization fails.

Use a fixed seed for layout. Bound construction, reuse geometry and materials, and instance or merge repeated detail. Avoid excessive independent meshes, lights, and transparent layers. Budget shadows and particles; cap pixel ratio sensibly. Do not rebuild static geometry or allocate continually each frame.

Prioritize a complete, responsive world with excellent composition over fragile effects. Resolve imports, initialization, movement, collision, entry, cutaway, and reset before optional flourishes. Return the finished executable HTML only.
