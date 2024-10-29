import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.165.0/three.module.min.js'
import Scene from './scene.js'

const RenderScene = new Scene()

let update_fn = undefined

let scene_objects = {}

function convertLHtoRH(x, y, z) {
  return new THREE.Vector3(x, y, -z);
}

function convertQuaternionLHtoRH(x, y, z, w) {
  return new THREE.Quaternion(-x, -y, z, w);
}

function convertScale(type, x, y, z) {
  if (type == "CYLINDER") return new THREE.Vector3(0.5 * x, 2 * y, 0.5 * z)
  else return new THREE.Vector3(x, y, z) 
}

function create_body(assets, body) {
  const bodyObj = new THREE.Group()
  bodyObj.name = body.name

  bodyObj.position.copy(convertLHtoRH(...body.trans.pos))
  bodyObj.quaternion.copy(convertQuaternionLHtoRH(...body.trans.rot))
  bodyObj.scale.set(...body.trans.scale)

  const visuals = new THREE.Group()
  visuals.name = "Visuals";
  bodyObj.add(visuals)

  body.visuals.forEach(visual => {
    const geometry = {
      "MESH":  () =>  assets.meshes[visual.mesh],
      "PLANE": () => new THREE.PlaneGeometry(),
      "SPHERE": () => new THREE.SphereGeometry(),
      "CUBE" : () => new THREE.BoxGeometry(),
      "CYLINDER" : () => new THREE.CylinderGeometry(),
      "CAPSULE" : () => new THREE.CapsuleGeometry(),
    }[visual.type]()
    
    const material = visual.material == undefined ? 
                new THREE.MeshPhysicalMaterial({color:new THREE.Color(...visual.color).getHex()}) 
                : assets.materials[visual.material]


    const visualObj = new THREE.Mesh(geometry, material)
    
    visualObj.position.copy(convertLHtoRH(...visual.trans.pos))
    visualObj.quaternion.copy(convertQuaternionLHtoRH(...visual.trans.rot))
    visualObj.scale.copy(convertScale(visual.type, ...visual.trans.scale))
    visuals.add(visualObj)
  })

  
  body.children.forEach(child => {
    const childObj = create_body(assets, child)
    bodyObj.add(childObj)
    scene_objects[child.name] = childObj
  })
  
  return bodyObj
}

function construct_scene(data) {
  
  if (update_fn) clearInterval(update_fn);

  RenderScene.clear()
  scene_objects = {}


  const root = create_body(data.assets, data.root)
  RenderScene.add_object(root)

  const center = new THREE.Vector3();
  const boundingBox = new THREE.Box3();
  
  boundingBox.setFromObject(root);
  boundingBox.getCenter(center);
  root.position.set(-center.x, 0.1 , -center.z)

  console.log("Loaded scene", root, data)

  update_fn = setInterval(() => {
    fetch("/scene_state")
    .then(response => response.json())
    .then(data => {
      if (!data) return
      Object.entries(data.updateData).forEach(entry => {
        const [name, value] = entry

        const obj = scene_objects[name]
        if (!obj) return

        const worldposition = convertLHtoRH(value[0], value[1], value[2]).add(root.position)
        const newquat = convertQuaternionLHtoRH(value[3], value[4], value[5], value[6]).multiply(root.quaternion)
        
        const localposition = obj.parent.worldToLocal(worldposition)
        obj.position.copy(localposition);
        
        const worldQuaternion = new THREE.Quaternion();
        obj.parent.getWorldQuaternion(worldQuaternion).invert()
        obj.quaternion.copy(worldQuaternion).multiply(newquat)
      })
    })
    .catch(error => console.error('Error updating the scene:', error))
  }, 20); 
}

function construct_mesh(mesh, data) {
  
  const geometry = new THREE.BufferGeometry();
  const uvs = new Float32Array(data, mesh.uvLayout[0], mesh.uvLayout[1]);

  const normals = new Float32Array(data, mesh.normalsLayout[0], mesh.normalsLayout[1]);
  const indices = new Uint32Array(data, mesh.indicesLayout[0], mesh.indicesLayout[1]);
  const vertices = new Float32Array(data, mesh.verticesLayout[0], mesh.verticesLayout[1]);
  
  for (let i = 0; i < vertices.length; i += 3) {
    vertices[i + 2] = -vertices[i + 2] 
  }
  
  for (let i = 0; i < normals.length; i += 3) {
    normals[i + 2] = -normals[i + 2] 
  }

  for (let i = 0; i < indices.length; i += 3) {
    let temp = indices[i]
    indices[i] = indices[i + 2]
    indices[i + 2] = temp
  }

  geometry.name = mesh.tag

  
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (uvs.length > 0) {
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  }

  return geometry  
}

function construct_material(material, textures) {

  
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(material.color[0], material.color[1], material.color[2]),
    emissive: new THREE.Color(material.emissionColor[0], material.emissionColor[1], material.emissionColor[2]),
    roughness: 1.0 - material.shininess, // Roughness is inverse of shininess
    metalness: material.reflectance,
    specularIntensity : material.specular,
  })
  
  if (material.texture != null) {
    if (!Object.hasOwn(textures, material.texture)) {
      console.error("Did not load", material.texture)
      return mat
    }
    mat.map = textures[material.texture]
    mat.needsUpdate = true
  } 


  return mat
}

function construct_texture(texture, data) {
  var tex = new THREE.DataTexture(new Uint8Array(data), texture.height, texture.width, THREE.RGBAFormat)
  tex.flipY = false
  tex.needsUpdate = true
  return tex
}


function load_scene() {
  fetch("/scene_data")
  .then(response => response.json())
  .then(scene => {   
    
    const meshes = {}
    const materials = {}
    const textures = {}

    // Contruct textures
    const texture_loaders = scene.textures.map(texture => {
      return fetch("/data/" + texture.dataHash)
      .then(response => response.blob())
      .then(data => data.arrayBuffer())
      .then(data => textures[texture.id] = construct_texture(texture, data))
      .catch(error => console.error('Error loading texture:', error));
    })
    
    const material_loaders = Promise.all(texture_loaders).then(_ => {
      scene.materials.forEach(material => materials[material.id] = construct_material(material, textures))
    })

    
    // Contruct meshes
    const mesh_loaders = scene.meshes.map(mesh => {
      return fetch("/data/" + mesh.dataHash)
      .then(response => response.blob())
      .then(data => data.arrayBuffer())
      .then(data => meshes[mesh.id] = construct_mesh(mesh, data))
      .catch(error => console.error('Error loading mesh:', error));
    })
    
    Promise.all([...mesh_loaders, material_loaders]).then(_ => {
      // construct the scene
      scene.assets = {
        meshes : meshes,
        textures : textures,
        materials : materials
      }

      construct_scene(scene) 
    })
  })
}




let current_id = 0

setInterval(() => {
  fetch("/scene_id")
  .then(response => response.json())
  .then(new_id => {
    if (current_id == new_id) return;
    console.log("Reloading scene")
    current_id = new_id
    load_scene()
  })
}, 1000); 

RenderScene.render()