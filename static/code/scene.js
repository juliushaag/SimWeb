import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.165.0/three.module.min.js'
import { OrbitControls } from './vendor/OrbitControls.js';


class Scene {
  constructor() {
    this.objects = []
    this.scene = new THREE.Scene();

    /* Renderer */
    this.renderer = new THREE.WebGLRenderer({canvas: document.querySelector('#scene_container'),  antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    /* Camera */
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.setZ(-1)

    /* Lighting */
    const ambientLight = new THREE.AmbientLight(0xffffff);
    const light = new THREE.DirectionalLight( 0xFFF4D6, 1.0 );
    light.position.set( 50, -30, 0);
    this.scene.add(ambientLight, light);

    /* Background */
    this.scene.background = new THREE.Color( 0xbfe3dd );


    /* Scene grid */
    const gridHelper = new THREE.GridHelper(10, 10);
    this.scene.add( gridHelper );

    /* Orbit controls */
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);

    window.onresize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix();
    
      this.renderer.setSize(window.innerWidth, window.innerHeight)  
    } 
  }

  add_object = function(object) {
    this.objects.push(object)
    this.scene.add(object)
  }

  clear() {
    this.objects.forEach(obj => this.scene.remove(obj))
    this.objects = []
  }

  render() {
    requestAnimationFrame(() => this.render());
  
    this.controls.update();
  
    this.renderer.render(this.scene, this.camera);
  }

}



export default Scene;

