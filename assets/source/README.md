# Source assets

Raw, unoptimised originals. Not served and not shipped in the Docker image.

- `washing-machine/source/xyj.glb` (+ `textures/`): the original washer model.
  The served, optimised copy is `public/models/washer.glb`.

To re-export the served model with geometry compression (the scene's GLTFLoader
registers the meshopt decoder, so a meshopt-compressed file loads as-is):

    npx @gltf-transform/cli meshopt assets/source/washing-machine/source/xyj.glb public/models/washer.glb
