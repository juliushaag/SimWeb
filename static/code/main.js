import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.165.0/three.module.min.js'
import Scene from './scene.js'

const RenderScene = new Scene()

let update_fn = undefined

let scene_objects = {}

function create_body(assets, body) {
  const bodyObj = new THREE.Object3D()
  bodyObj.name = body.name

  scene_objects[body.name] = bodyObj

  bodyObj.position.set(...body.trans.pos)
  bodyObj.quaternion.set(...body.trans.rot)
  bodyObj.scale.set(...body.trans.scale)

  const visuals = new THREE.Group()
  visuals.name = "Visuals";
  bodyObj.add(visuals)

  body.visuals.forEach(visual => {
    const geometry = {
      "MESH":  () =>  assets["MESH"][visual.mesh],
      "PLANE": () => new THREE.PlaneGeometry(),
      "SPHERE": () => new THREE.SphereGeometry(),
      "CUBE" : () => new THREE.BoxGeometry(),
      "CYLINDER" : () => new THREE.CylinderGeometry(),
      "CAPSULE" : () => new THREE.CapsuleGeometry(),
    }[visual.type]()
    
    const material = visual.material == undefined ? 
                new THREE.MeshStandardMaterial({color:new THREE.Color(...visual.color).getHex()}) 
                : assets["MATERIAL"][visual.material]


    const visualObj = new THREE.Mesh(geometry, material)
    
    visualObj.position.set(...visual.trans.pos)
    visualObj.quaternion.set(...visual.trans.rot)
    visualObj.scale.set(...visual.trans.scale)
    visuals.add(visualObj)
  })

  
  body.children.forEach(child => {
    bodyObj.add(create_body(assets, child))
  })
  
  return bodyObj
}

function construct_scene(data) {
  if (update_fn != undefined) clearInterval(setInterval);
  RenderScene.clear()
  scene_objects = {}


  const root = create_body(data.assets, data.root)
  RenderScene.add_object(root)

  update_fn = setInterval(() => {
    fetch("/scene_state")
    .then(response => response.json())
    .then(data => {
      if (data != {}) {
        Object.entries(data.updateData).forEach(entry => {
          const [name, value] = entry

          const obj = scene_objects[name]
          const worldposition = new THREE.Vector3(value[0], value[1], value[2])
          const newquat = new THREE.Quaternion(value[3], value[4], value[5], value[6])

           // If object has a parent
          if (obj.parent) {
            obj.parent.worldToLocal(worldposition);
            obj.position.copy(worldposition);
            
            const worldQuaternion = new THREE.Quaternion();
            obj.parent.getWorldQuaternion(worldQuaternion);
            worldQuaternion.invert();
            obj.quaternion.multiplyQuaternions(worldQuaternion, newquat);
          
          } else {
            // If no parent, world position is the same as local
            obj.position.copy(worldposition);
            obj.quaternion.set(newquat)
          }
        })
      }
    })
    .catch()
  }, 20); 
}

function construct_mesh(mesh, data) {
  
  const geometry = new THREE.BufferGeometry();
  const uvs = new Float32Array(data, mesh.uvLayout[0], mesh.uvLayout[1]);
  const normals = new Float32Array(data, mesh.normalsLayout[0], mesh.normalsLayout[1]);
  const indices = new Uint32Array(data, mesh.indicesLayout[0], mesh.indicesLayout[1]);
  const vertices = new Float32Array(data, mesh.verticesLayout[0], mesh.verticesLayout[1]);

  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (uvs.length > 0) {
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  }
  geometry.name = mesh.tag

  return geometry  
}

function construct_material(material, textures) {

  
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(material.color[0], material.color[1], material.color[2]),
    emissive: new THREE.Color(material.emissionColor[0], material.emissionColor[1], material.emissionColor[2]),
    roughness: 1.0 - material.shininess, // Roughness is inverse of shininess
    metalness: material.reflectance,
    specularIntensity : material.specular,
    map : material.texture != null ? textures[material.texture] : undefined 
  })


  return mat
}

function construct_texture(texture, data) {
  var tex = new THREE.DataTexture(data, texture.height, texture.width, THREE.RGBAIntegerFormat)
  tex.needsUpdate = true;
  return tex
}


function load_scene() {
  fetch("/scene_data")
  .then(response => response.json())
  .then(scene => {   
    
    scene.assets = { "MESH" : {}, "MATERIAL" : {}, "TEXTURE" : {} }

    // Contruct textures
    const texture_loaders = scene.textures.map(texture => {
      return fetch("/data/" + texture.dataHash)
      .then(response => response.blob())
      .then(data => data.arrayBuffer())
      .then(data => scene.assets["TEXTURE"][texture.id] = construct_texture(texture, data))
      .catch(error => console.error('Error loading texture:', error));
    })
    

    // Contruct materials
    scene.materials.forEach(material => scene.assets["MATERIAL"][material.id] = construct_material(material, scene.assets["TEXTURE"]))

    // Contruct meshes
    const mesh_loaders = scene.meshes.map(mesh => {
      return fetch("/data/" + mesh.dataHash)
      .then(response => response.blob())
      .then(data => data.arrayBuffer())
      .then(data => scene.assets["MESH"][mesh.id] = construct_mesh(mesh, data))
      .catch(error => console.error('Error loading mesh:', error));
    })
    
    
    Promise.all(mesh_loaders, texture_loaders).then(_ => construct_scene(scene)) // construct the scene
  })
}




let current_id = 0

setInterval(() => {
  fetch("/scene_id")
  .then(response => response.json())
  .then(new_id => {
    if (current_id == new_id) return;
    current_id = new_id
    load_scene()
  })
}, 1000); 

RenderScene.render()