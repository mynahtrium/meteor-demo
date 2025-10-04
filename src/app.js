import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

class App {
  constructor() {
    // Scene objects
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;

    // simulation state
    this.meteors = [];
    this.impactEffects = [];
    this.labels = [];

    // UI/state
    this.simSpeed = 1;
    this.realistic = false;
    this.paused = false;
    this.impactCount = 0;
    this.showAiming = true;
    this.showAtmosphere = true;
    this.showMoon = true;
    this.showGravityViz = false;
    this.enableExplosions = true;
    this.lastMeteorData = null;
    this.cameraFocus = 'free'; // 'free', 'earth', 'moon', 'meteor'
    this.focusedMeteor = null;
    this.gravityVisualizers = [];
    this.explosionEffects = [];
    this.trajectoryLines = [];
    this.simulationStartTime = Date.now();
    this.lastUpdateTime = Date.now();
    
    // Statistics tracking
    this.totalImpactEnergy = 0;
    this.largestImpactEnergy = 0;
    this.impactCount = 0;
    this.frameCount = 0;
    this.lastFpsTime = Date.now();
    this.currentFps = 60;
    
    // Map tracking
    this.impactLocations = [];
    this.mapCanvas = null;
    this.mapCtx = null;

    // physics
    this.G = 6.67430e-11;
    this.earthMass = 5.972e24;
    this.earthRadiusMeters = 6371000;
    this.SCENE_SCALE = 1e5; // meters per scene unit (changed from 1e6 to make Earth larger)
    this.earthRadius = this.earthRadiusMeters / this.SCENE_SCALE; // scene units
    this.gravityStrength = 2.0; // Much more powerful gravity for realistic simulation

    // Moon properties
    this.moonMass = 7.342e22; // kg
    this.moonRadiusMeters = 1737400; // meters
    this.moonRadius = this.moonRadiusMeters / this.SCENE_SCALE; // scene units
    this.moonDistance = 384400000 / this.SCENE_SCALE; // scene units (384,400 km)
    this.moonOrbitalSpeed = 1022 / this.SCENE_SCALE; // m/s converted to scene units
    this.moonAngle = 0; // current orbital angle

    // Earth-Moon system only
    this.earthMoonSystem = {
      earth: {
        name: 'Earth',
        mass: 5.972e24, // kg
        radius: 6371000, // meters
        position: new THREE.Vector3(0, 0, 0),
        color: 0x6b93d6
      },
      moon: {
        name: 'Moon',
        mass: 7.342e22, // kg
        radius: 1737400, // meters
        distance: 384400000 / this.SCENE_SCALE, // 384,400 km in scene units
        orbitalSpeed: 0.000001, // radians per frame
        angle: 0,
        color: 0xcccccc
      }
    };

    // Atmosphere properties
    this.atmosphereHeight = 100000; // 100km in meters
    this.atmosphereHeightScene = this.atmosphereHeight / this.SCENE_SCALE; // scene units
    this.atmosphereDensity = 1.225; // kg/m³ at sea level
    this.dragCoefficient = 0.47; // for spherical objects
    this.burnTemperature = 1500; // Kelvin
    this.burnSpeedThreshold = 2000; // m/s - speed at which burning starts

    this.mouse = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();

    // placeholders
    this.cursor = null;
    this.predictedImpactMarker = null;
    // camera framing state for smooth on-spawn framing
    this.cameraFrame = { active: false };
  }

  // Smoothly frame the camera to look at `targetPos` and move camera to `endCamPos` over `durationMs`
  frameCameraTo(targetPos, endCamPos, durationMs = 1200){
    this.cameraFrame = {
      active: true,
      startTime: Date.now(),
      duration: durationMs,
      startCamPos: this.camera.position.clone(),
      endCamPos: endCamPos.clone(),
      startTarget: this.controls.target.clone(),
      endTarget: targetPos.clone()
    };
  }

  createLabel(text, position) {
    const div = document.createElement('div');
    div.className = 'label';
    div.style.position = 'absolute';
    div.style.color = 'white';
    div.style.fontSize = '14px';
    div.innerText = text;
    document.body.appendChild(div);
    const label = { element: div, position };
    this.labels.push(label);
    return label;
  }

  updateLabels() {
    this.labels.forEach(label => {
      const vector = label.position.clone();
      vector.project(this.camera);
      const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-vector.y * 0.5 + 0.5) * window.innerHeight;
      label.element.style.left = `${x}px`;
      label.element.style.top = `${y}px`;
    });
  }

  init() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 10000);
    this.camera.position.set(0, 3, 15);
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
  this.renderer.setSize(window.innerWidth, window.innerHeight);
  // Ensure correct color space for loaded textures
  this.renderer.outputEncoding = THREE.sRGBEncoding;
  this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  this.renderer.toneMappingExposure = 1.0;
    document.body.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);

    // Earth
    const earthGeo = new THREE.SphereGeometry(this.earthRadius, 32, 32);
    const earthMat = new THREE.MeshPhongMaterial({ color: 0x2233ff });
    const earth = new THREE.Mesh(earthGeo, earthMat);
    this.scene.add(earth);
    this.createLabel('Earth', new THREE.Vector3(0, this.earthRadius + 0.2, 0));

    // Atmosphere visualization
    const atmosphereGeo = new THREE.SphereGeometry(this.earthRadius + this.atmosphereHeightScene, 32, 32);
    const atmosphereMat = new THREE.MeshBasicMaterial({ 
      color: 0x87CEEB, 
      transparent: true, 
      opacity: 0.1,
      side: THREE.BackSide
    });
    const atmosphere = new THREE.Mesh(atmosphereGeo, atmosphereMat);
    atmosphere.name = 'atmosphere';
    this.scene.add(atmosphere);

    // Moon
    const moonGeo = new THREE.SphereGeometry(this.moonRadius, 16, 16);
    const moonMat = new THREE.MeshPhongMaterial({ color: 0xcccccc, roughness: 0.8 });
    const moon = new THREE.Mesh(moonGeo, moonMat);
    moon.name = 'moon';
    moon.position.set(this.moonDistance, 0, 0);
    this.scene.add(moon);
    this.createLabel('Moon', new THREE.Vector3(this.moonDistance + this.moonRadius + 0.2, 0, 0));

    // Earth-Moon system is already created above

  // Lighting: ambient + hemisphere + directional (sun) — but we do not add a visible Sun mesh
  this.scene.add(new THREE.AmbientLight(0xffffff, 0.28));
  const hemi = new THREE.HemisphereLight(0xaaaaff, 0x222244, 0.6);
  this.scene.add(hemi);
  // directional light to simulate sunlight
  const dirLight = new THREE.DirectionalLight(0xfff8e6, 1.0);
  dirLight.position.set(10, 10, 10);
  dirLight.castShadow = false;
  this.scene.add(dirLight);
    const cameraLight = new THREE.PointLight(0xffeecc, 1.0, 100);
    this.camera.add(cameraLight);

    // cursor group
    this.cursor = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(0.05, 0.08, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.name = 'cursorRing';
    this.cursor.add(ring);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.9 });
    const crossSize = 0.06;
    const crossXGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-crossSize, 0, 0), new THREE.Vector3(crossSize, 0, 0)]);
    const crossYGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -crossSize, 0), new THREE.Vector3(0, crossSize, 0)]);
    this.cursor.add(new THREE.Line(crossXGeo, lineMat));
    this.cursor.add(new THREE.Line(crossYGeo, lineMat));
    this.scene.add(this.cursor);

    // aiming line
    const aimMat = new THREE.LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.6 });
    const aimGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
    const aimingLine = new THREE.Line(aimGeo, aimMat);
    aimingLine.name = 'aimingLine';
    this.scene.add(aimingLine);

    // predicted impact marker
    const pGeo = new THREE.SphereGeometry(0.03, 8, 8);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xff5500 });
    this.predictedImpactMarker = new THREE.Mesh(pGeo, pMat);
    this.predictedImpactMarker.visible = false;
    this.scene.add(this.predictedImpactMarker);

    // mouse-follow cursor
    const mcGeo = new THREE.SphereGeometry(0.03, 8, 8);
    const mcMat = new THREE.MeshBasicMaterial({ color: 0xffff66 });
    const mouseCursor = new THREE.Mesh(mcGeo, mcMat);
    mouseCursor.name = 'mouseCursor';
    this.scene.add(mouseCursor);

    // events
    window.addEventListener('resize', () => this.onWindowResize());
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));

    // wire basic UI elements safely
    const el = id => document.getElementById(id);
    if (el('simSpeed')) el('simSpeed').oninput = (e) => { this.simSpeed = parseFloat(e.target.value); if (el('simSpeedVal')) el('simSpeedVal').innerText = parseFloat(e.target.value).toFixed(2); if (el('simSpeedInput')) el('simSpeedInput').value = this.simSpeed; };
    if (el('simSpeedInput')) el('simSpeedInput').oninput = (e) => { this.simSpeed = Math.max(0.01, Math.min(1000, parseFloat(e.target.value) || 1)); if (el('simSpeed')) el('simSpeed').value = this.simSpeed; if (el('simSpeedVal')) el('simSpeedVal').innerText = this.simSpeed.toFixed(2); };
    if (el('speed')) { const s = el('speed'); if (el('speedVal')) el('speedVal').innerText = s.value; s.oninput = (e) => { if (el('speedVal')) el('speedVal').innerText = parseFloat(e.target.value).toFixed(2); if (el('speedInput')) el('speedInput').value = parseFloat(e.target.value); }; }
    if (el('speedInput')) el('speedInput').oninput = (e) => { const speed = Math.max(0.01, Math.min(10, parseFloat(e.target.value) || 0.05)); if (el('speed')) el('speed').value = speed; if (el('speedVal')) el('speedVal').innerText = speed.toFixed(2); };
    if (el('reset')) el('reset').onclick = () => this.resetScene();
    if (el('pause')) el('pause').onclick = (e) => { this.paused = !this.paused; e.target.innerText = this.paused ? 'Resume' : 'Pause'; };
    if (el('toggleAiming')) el('toggleAiming').onclick = (e) => { this.showAiming = !this.showAiming; e.target.innerText = this.showAiming ? 'Hide Aiming' : 'Show Aiming'; const aim = this.scene.getObjectByName('aimingLine'); if (aim) aim.visible = this.showAiming; };
    if (el('fire')) el('fire').onclick = () => this.shootMeteor();
    if (el('loadMore')) el('loadMore').onclick = () => this.fetchAsteroidList(true);
    if (el('highResTex')) el('highResTex').onclick = () => this.loadHighResEarthTexture();
    const uploadInput = el('uploadTex');
    if (uploadInput) uploadInput.addEventListener('change', (ev) => this.onUploadTexture(ev));
    const realBtn = el('toggleRealism'); if(realBtn) realBtn.onclick = (e)=>{ this.realistic = !this.realistic; e.target.innerText = this.realistic? 'Disable Realistic Physics' : 'Enable Realistic Physics'; };
    const atmBtn = el('toggleAtmosphere'); if(atmBtn) atmBtn.onclick = (e)=>{ this.showAtmosphere = !this.showAtmosphere; e.target.innerText = this.showAtmosphere? 'Hide Atmosphere' : 'Show Atmosphere'; const atm = this.scene.getObjectByName('atmosphere'); if(atm) atm.visible = this.showAtmosphere; };
    const moonBtn = el('toggleMoon'); if(moonBtn) moonBtn.onclick = (e)=>{ this.showMoon = !this.showMoon; e.target.innerText = this.showMoon? 'Hide Moon' : 'Show Moon'; const moon = this.scene.getObjectByName('moon'); if(moon) moon.visible = this.showMoon; };
    const gravityBtn = el('toggleGravityViz'); if(gravityBtn) gravityBtn.onclick = (e)=>{ this.showGravityViz = !this.showGravityViz; e.target.innerText = this.showGravityViz? 'Hide Gravity Fields' : 'Show Gravity Fields'; this.toggleGravityVisualizers(); };
    if (el('spawnAsteroid')) el('spawnAsteroid').onclick = () => this.spawnSelectedAsteroid();
    
    // Camera focus buttons
    if (el('focusEarth')) el('focusEarth').onclick = () => this.focusOnEarth();
    if (el('focusMoon')) el('focusMoon').onclick = () => this.focusOnMoon();
    if (el('focusMeteor')) el('focusMeteor').onclick = () => this.focusOnLastMeteor();
    if (el('focusFree')) el('focusFree').onclick = () => this.setFreeCamera();

    // initial aiming visibility
    const aimObj = this.scene.getObjectByName('aimingLine'); if (aimObj) aimObj.visible = this.showAiming;

    // attempt to auto-load a local earth texture file if present (project root: earth_texture.jpg)
    try { this.tryLoadLocalEarthTexture(); } catch(e){ /* ignore */ }
    
    // Initialize map
    this.initMap();
  }

  tryLoadLocalEarthTexture(){
    const localPath = './earth_texture.jpg';
    const loader = new THREE.TextureLoader();
    loader.load(localPath, tex => {
      const earth = this.scene.children.find(c=>c.geometry && c.geometry.type==='SphereGeometry');
      if(earth && earth.material){
        if(earth.material.color) earth.material.color.setHex(0xffffff);
        tex.encoding = THREE.sRGBEncoding;
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        earth.material.map = tex; earth.material.needsUpdate = true;
        console.log('Loaded local earth texture:', localPath);
      }
    }, undefined, err => {
      // silent fail if not present or CORS
      console.debug('Local earth texture not found or failed to load:', localPath, err && err.message);
    });
  }

  onUploadTexture(ev) {
    const f = ev.target.files && ev.target.files[0];
    if(!f) return;
    const url = URL.createObjectURL(f);
    const loader = new THREE.TextureLoader();
    loader.load(url, tex=>{
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      if(this.scene && this.scene.children){
        const earth = this.scene.children.find(c=>c.geometry && c.geometry.type==='SphereGeometry');
        if(earth && earth.material){
          // ensure material does not tint the texture
          if(earth.material.color) earth.material.color.setHex(0xffffff);
          tex.encoding = THREE.sRGBEncoding;
          earth.material.map = tex; earth.material.needsUpdate = true;
        }
      }
      URL.revokeObjectURL(url);
    }, undefined, err=>{ console.error('Local texture load failed', err); alert('Local texture failed to load'); });
  }

  onMouseMove(event) {
    this.mouse.x = (event.clientX/window.innerWidth)*2-1;
    this.mouse.y = -(event.clientY/window.innerHeight)*2+1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const planeZ = new THREE.Plane(new THREE.Vector3(0,0,-1).applyQuaternion(this.camera.quaternion), -5);
    const intersection = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(planeZ, intersection);
    if(this.cursor) {
      this.cursor.position.copy(intersection);
      this.cursor.lookAt(this.camera.position);
      const ringMesh = this.cursor.getObjectByName('cursorRing');
      if(ringMesh) ringMesh.rotation.copy(new THREE.Euler(Math.PI/2,0,0));
    }
  }

  onKeyDown(event) { 
    if(event.code === 'Space') {
      // Check if a NASA meteor is selected, otherwise fire basic meteor
      const select = document.getElementById('asteroidSelect');
      if (select && select.value) {
        this.fireSelectedAsteroid();
      } else {
        this.shootMeteor();
      }
    } else if(event.code === 'KeyR') {
      // R key to reset scene
      this.resetScene();
    } else if(event.code === 'KeyP') {
      // P key to pause/resume
      this.paused = !this.paused;
      const pauseBtn = document.getElementById('pause');
      if (pauseBtn) pauseBtn.innerText = this.paused ? 'Resume' : 'Pause';
    } else if(event.code === 'KeyE') {
      // E key to focus on Earth
      this.focusOnEarth();
    } else if(event.code === 'KeyM') {
      // M key to focus on Moon
      this.focusOnMoon();
    } else if(event.code === 'KeyT') {
      // T key to focus on last meteor
      this.focusOnLastMeteor();
    } else if(event.code === 'KeyF') {
      // F key for free camera
      this.setFreeCamera();
    } else if(event.code === 'KeyG') {
      // G key to toggle gravity fields
      this.showGravityViz = !this.showGravityViz;
      const gravityBtn = document.getElementById('toggleGravityViz');
      if (gravityBtn) gravityBtn.innerText = this.showGravityViz ? 'Hide Gravity Fields' : 'Show Gravity Fields';
      this.toggleGravityVisualizers();
    }
  }

  // Camera focus functions
  focusOnEarth() {
    this.cameraFocus = 'earth';
    this.focusedMeteor = null;
    const earthPos = new THREE.Vector3(0, 0, 0);
    const cameraPos = new THREE.Vector3(0, 0, this.earthRadius * 3);
    this.frameCameraTo(earthPos, cameraPos, 1500);
  }

  focusOnMoon() {
    this.cameraFocus = 'moon';
    this.focusedMeteor = null;
    const moon = this.scene.getObjectByName('moon');
    if (moon) {
      const moonPos = moon.position.clone();
      const cameraPos = moonPos.clone().add(new THREE.Vector3(0, 0, this.moonRadius * 5));
      this.frameCameraTo(moonPos, cameraPos, 1500);
    }
  }

  focusOnLastMeteor() {
    if (this.meteors.length > 0) {
      this.cameraFocus = 'meteor';
      this.focusedMeteor = this.meteors[this.meteors.length - 1];
      const meteorPos = this.focusedMeteor.mesh.position.clone();
      
      // Convert meteor size to scene units for proper camera distance
      const meteorSizeScene = this.focusedMeteor.size / this.SCENE_SCALE;
      const cameraDistance = Math.max(meteorSizeScene * 20, this.earthRadius * 0.5); // At least half Earth radius
      const cameraPos = meteorPos.clone().add(new THREE.Vector3(0, 0, cameraDistance));
      
      this.frameCameraTo(meteorPos, cameraPos, 1500);
    }
  }

  setFreeCamera() {
    this.cameraFocus = 'free';
    this.focusedMeteor = null;
  }


  // Update camera focus
  updateCameraFocus() {
    if (this.cameraFocus === 'free') return; // Don't update camera in free mode
    
    if (this.cameraFocus === 'earth') {
      const earthPos = new THREE.Vector3(0, 0, 0);
      const cameraPos = new THREE.Vector3(0, 0, this.earthRadius * 3);
      this.camera.position.lerp(cameraPos, 0.05);
      this.controls.target.lerp(earthPos, 0.05);
    } else if (this.cameraFocus === 'moon') {
      const moon = this.scene.getObjectByName('moon');
      if (moon) {
        const moonPos = moon.position.clone();
        const cameraPos = moonPos.clone().add(new THREE.Vector3(0, 0, this.moonRadius * 5));
        this.camera.position.lerp(cameraPos, 0.05);
        this.controls.target.lerp(moonPos, 0.05);
      }
    } else if (this.cameraFocus === 'meteor' && this.focusedMeteor && this.focusedMeteor.active) {
      const meteorPos = this.focusedMeteor.mesh.position.clone();
      
      // Convert meteor size to scene units for proper camera distance
      const meteorSizeScene = this.focusedMeteor.size / this.SCENE_SCALE;
      const cameraDistance = Math.max(meteorSizeScene * 20, this.earthRadius * 0.5);
      
      // Calculate camera position relative to meteor, maintaining current offset
      const currentOffset = this.camera.position.clone().sub(meteorPos);
      const targetOffset = currentOffset.normalize().multiplyScalar(cameraDistance);
      const cameraPos = meteorPos.clone().add(targetOffset);
      
      this.camera.position.lerp(cameraPos, 0.05);
      this.controls.target.lerp(meteorPos, 0.05);
    } else if (this.cameraFocus === 'meteor' && (!this.focusedMeteor || !this.focusedMeteor.active)) {
      // If focused meteor is no longer active, switch to free camera
      this.setFreeCamera();
    }
  }

  // Update moon orbital position
  updateMoon() {
    const moon = this.scene.getObjectByName('moon');
    if (!moon) return;
    
    // Update orbital angle
    this.moonAngle += this.moonOrbitalSpeed * this.simSpeed * 0.02;
    if (this.moonAngle > Math.PI * 2) this.moonAngle -= Math.PI * 2;
    
    // Calculate new position
    const x = Math.cos(this.moonAngle) * this.moonDistance;
    const z = Math.sin(this.moonAngle) * this.moonDistance;
    moon.position.set(x, 0, z);
    
    // Update moon label position
    const moonLabel = this.labels.find(l => l.element.innerText.includes('Moon'));
    if (moonLabel) {
      moonLabel.position.set(x + this.moonRadius + 0.2, 0, z);
    }
  }


  // Calculate gravitational force from moon
  calculateMoonGravity(meteor) {
    const moon = this.scene.getObjectByName('moon');
    if (!moon) return new THREE.Vector3();
    
    const meteorPos = meteor.mesh.position.clone().multiplyScalar(this.SCENE_SCALE);
    const moonPos = moon.position.clone().multiplyScalar(this.SCENE_SCALE);
    const distance = meteorPos.distanceTo(moonPos);
    
    if (distance < 1) return new THREE.Vector3(); // Avoid division by zero
    
    const force = this.G * this.moonMass * meteor.mass / (distance * distance);
    const direction = moonPos.sub(meteorPos).normalize();
    
    return direction.multiplyScalar(force);
  }

  // Calculate gravitational force from Earth
  calculateEarthGravity(meteor) {
    const earthPos = new THREE.Vector3(0, 0, 0);
    const meteorPos = meteor.mesh.position.clone().multiplyScalar(this.SCENE_SCALE);
    const distance = meteorPos.length();
    
    if (distance < 1) return new THREE.Vector3(); // Avoid division by zero
    
    const force = this.G * this.earthMass * meteor.mass / (distance * distance);
    const direction = earthPos.sub(meteorPos).normalize();
    
    return direction.multiplyScalar(force);
  }

  // Calculate meteor gravity force on another meteor
  calculateMeteorGravity(meteor, otherMeteor) {
    if (meteor === otherMeteor) return new THREE.Vector3(0, 0, 0);
    
    const meteorPos = meteor.mesh.position.clone().multiplyScalar(this.SCENE_SCALE);
    const otherPos = otherMeteor.mesh.position.clone().multiplyScalar(this.SCENE_SCALE);
    const toOther = otherPos.sub(meteorPos);
    const distance = toOther.length();
    
    if (distance < 0.1) return new THREE.Vector3(0, 0, 0); // Avoid division by zero
    
    const forceMagnitude = this.G * otherMeteor.mass * meteor.mass / (distance * distance);
    return toOther.normalize().multiplyScalar(forceMagnitude);
  }

  // Calculate atmospheric density at given altitude
  getAtmosphericDensity(altitude) {
    // Simplified atmospheric model - density decreases exponentially with altitude
    const scaleHeight = 8400; // meters
    return this.atmosphereDensity * Math.exp(-altitude / scaleHeight);
  }

  // Calculate drag force on meteor
  calculateDragForce(meteor) {
    const altitude = meteor.mesh.position.length() * this.SCENE_SCALE - this.earthRadiusMeters;
    if (altitude < 0) return new THREE.Vector3(); // Below surface
    
    const density = this.getAtmosphericDensity(altitude);
    const speed = meteor.physVelocity ? meteor.physVelocity.length() : meteor.velocity.length() * this.SCENE_SCALE;
    
    if (speed < 1) return new THREE.Vector3(); // No drag for very slow objects
    
    const area = meteor.area || Math.PI * Math.pow(meteor.size / 2, 2);
    const dragForce = 0.5 * density * speed * speed * this.dragCoefficient * area;
    
    // Drag force opposes velocity direction
    const velocity = meteor.physVelocity ? meteor.physVelocity.clone() : meteor.velocity.clone().multiplyScalar(this.SCENE_SCALE);
    const dragDirection = velocity.normalize().multiplyScalar(-1);
    
    return dragDirection.multiplyScalar(dragForce);
  }

  // Check if meteor should burn up
  shouldBurnUp(meteor) {
    const altitude = meteor.mesh.position.length() * this.SCENE_SCALE - this.earthRadiusMeters;
    if (altitude > this.atmosphereHeight) return false;
    
    const speed = meteor.physVelocity ? meteor.physVelocity.length() : meteor.velocity.length() * this.SCENE_SCALE;
    return speed > this.burnSpeedThreshold;
  }

  // Create burning effect for meteor
  createBurnEffect(meteor) {
    const burnGeo = new THREE.SphereGeometry(meteor.size * 2, 8, 8);
    const burnMat = new THREE.MeshBasicMaterial({ 
      color: 0xff4400, 
      transparent: true, 
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });
    const burnEffect = new THREE.Mesh(burnGeo, burnMat);
    burnEffect.position.copy(meteor.mesh.position);
    this.scene.add(burnEffect);
    
    // Add to impact effects for cleanup
    this.impactEffects.push({ 
      mesh: burnEffect, 
      type: 'burn',
      lifetime: 0.5 // seconds
    });
  }

  // Create gravity field visualizer
  createGravityVisualizer(object, mass, color = 0x00ff00) {
    if (!object || !object.position) return null;
    
    const radius = Math.sqrt(mass / this.earthMass) * this.earthRadius * 2; // Scale based on mass
    const geo = new THREE.SphereGeometry(radius, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ 
      color: color, 
      transparent: true, 
      opacity: 0.2,
      wireframe: true,
      side: THREE.DoubleSide
    });
    const viz = new THREE.Mesh(geo, mat);
    viz.position.copy(object.position);
    viz.name = `gravityViz_${object.name || 'unknown'}`;
    this.scene.add(viz);
    this.gravityVisualizers.push({ mesh: viz, target: object });
    return viz;
  }

  // Update gravity visualizers
  updateGravityVisualizers() {
    this.gravityVisualizers.forEach(viz => {
      if (viz.target && viz.target.position) {
        viz.mesh.position.copy(viz.target.position);
      }
    });
  }

  // Create simple explosion effect
  createExplosion(position, energy) {
    if (!this.enableExplosions) return;
    
    // Add to impact map
    this.addImpactToMap(position, energy);
    
    // Log explosion data
    const kilotons = energy / 4.184e12;
    console.log(`Impact: ${kilotons.toFixed(2)} kt`);
  }



  // Update explosion effects
  updateExplosionEffects() {
    // Iterate backwards to safely remove items
    for (let i = this.explosionEffects.length - 1; i >= 0; i--) {
      const effect = this.explosionEffects[i];
      effect.lifetime -= 0.02 * this.simSpeed;
      
      // Update particles
      if (effect.group && effect.group.children) {
        effect.group.children.forEach(particle => {
          if (particle.userData) {
            particle.position.add(particle.userData.velocity.clone().multiplyScalar(0.02 * this.simSpeed));
            particle.userData.lifetime -= 0.02 * this.simSpeed;
            particle.material.opacity = particle.userData.lifetime / particle.userData.maxLifetime;
          }
        });
      }
      
      // Remove if expired
      if (effect.lifetime <= 0) {
        if (effect.group) {
          this.scene.remove(effect.group);
        }
        this.explosionEffects.splice(i, 1);
      }
    }
  }

  // Toggle gravity visualizers
  toggleGravityVisualizers() {
    if (this.showGravityViz) {
      // Create gravity visualizers for Earth and Moon
      const earth = this.scene.children.find(c => c.geometry && c.geometry.type === 'SphereGeometry' && c.name !== 'moon');
      if (earth) {
        earth.name = 'earth';
        this.createGravityVisualizer(earth, this.earthMass, 0x00ff00);
      }
      
      const moon = this.scene.getObjectByName('moon');
      if (moon) {
        this.createGravityVisualizer(moon, this.moonMass, 0x0088ff);
      }
      
      // Add gravity visualizers for all meteors
      this.meteors.forEach(meteor => {
        if (meteor.active) {
          this.createGravityVisualizer(meteor.mesh, meteor.mass, 0xff8800);
        }
      });
    } else {
      // Remove all gravity visualizers
      this.gravityVisualizers.forEach(viz => {
        this.scene.remove(viz.mesh);
      });
      this.gravityVisualizers = [];
    }
  }

  // Fire selected NASA asteroid from camera position
  async fireSelectedAsteroid() {
    if (!this.cursor || !this.cursor.position) {
      console.warn('Cursor not initialized, cannot fire asteroid');
      return;
    }
    
    const select = document.getElementById('asteroidSelect');
    if (!select || !select.value) return;
    
    const details = await this.fetchAsteroidDetails(select.value) || (this.asteroidList || []).find(a => a.id === select.value);
    if (!details) return;
    
    // Calculate mid-size from min and max diameter
    const minSize = details.estimated_diameter.meters.estimated_diameter_min;
    const maxSize = details.estimated_diameter.meters.estimated_diameter_max;
    const midSize = (minSize + maxSize) / 2;
    
    // Calculate realistic mass and properties
    const density = 3000; // kg/m³ - typical asteroid density
    const volume = (4/3) * Math.PI * Math.pow(midSize/2, 3);
    const mass = density * volume;
    const area = Math.PI * Math.pow(midSize/2, 2);
    
    // Create meteor mesh
    const meteorGeo = new THREE.SphereGeometry(1, 16, 16);
    const meteorMat = new THREE.MeshStandardMaterial({ 
      color: 0xaaaaaa, 
      metalness: 0.1, 
      roughness: 0.6 
    });
    const meteor = new THREE.Mesh(meteorGeo, meteorMat);
    
    // Position meteor at camera position
    meteor.position.copy(this.camera.position);
    
    // Scale meteor to actual size - fix scaling to match Earth size
    const radiusMeters = midSize / 2; // radius in meters
    const radiusScene = radiusMeters / this.SCENE_SCALE; // convert to scene units
    meteor.scale.setScalar(Math.max(radiusScene, 1e-6));
    
    
    this.scene.add(meteor);
    const label = this.createLabel(`${details.name} (${midSize.toFixed(0)} m)`, meteor.position);
    
    // Calculate direction from camera to cursor
    const dir = new THREE.Vector3().subVectors(this.cursor.position, this.camera.position).normalize();
    
    // Use the meteor speed from UI
    const speedEl = document.getElementById('speed');
    const speed = speedEl ? parseFloat(speedEl.value) : 0.05;
    
    // Convert velocity to scene units and create physics velocity
    const sceneVelocity = dir.multiplyScalar(speed);
    const physVelocity = dir.clone().multiplyScalar(speed * this.SCENE_SCALE);
    
    // Add meteor with all properties
    const asteroidData = { 
      mesh: meteor, 
      velocity: sceneVelocity, 
      physVelocity: physVelocity, 
      active: true, 
      mass, 
      area, 
      size: midSize,
      burning: false,
      burnIntensity: 0,
      label,
      asteroidData: details, // Store original asteroid data
      entrySpeed: speed * this.SCENE_SCALE, // m/s
      energy: 0.5 * mass * Math.pow(speed * this.SCENE_SCALE, 2)
    };
    
    this.meteors.push(asteroidData);
    this.lastMeteorData = asteroidData;
    this.updateMeteorStats();
    
    // Create trajectory line
    this.createTrajectoryLine(asteroidData);
  }

  // Create trajectory line for meteor
  createTrajectoryLine(meteor) {
    const points = this.calculateTrajectory(meteor);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ 
      color: 0x00ff00, 
      transparent: true, 
      opacity: 0.7,
      linewidth: 2
    });
    const line = new THREE.Line(geometry, material);
    line.name = `trajectory_${meteor.mesh.id}`;
    this.scene.add(line);
    this.trajectoryLines.push({ line, meteor });
  }

  // Calculate trajectory points for meteor
  calculateTrajectory(meteor) {
    const points = [];
    const startPos = meteor.mesh.position.clone();
    const velocity = meteor.velocity.clone();
    const steps = 500; // Increased steps for longer trajectory
    const dt = 0.1;
    
    let pos = startPos.clone();
    let vel = velocity.clone();
    
    for (let i = 0; i < steps; i++) {
      points.push(pos.clone());
      
      // Simple physics simulation for trajectory
      const r = pos.length();
      if (r < this.earthRadius + 0.2) break; // Stop if hitting Earth
      
      // Apply gravity
      const gravityAccel = pos.clone().normalize().multiplyScalar(-this.gravityStrength / (r * r));
      vel.add(gravityAccel.multiplyScalar(dt));
      pos.add(vel.clone().multiplyScalar(dt));
      
      // Continue trajectory indefinitely (no distance limit)
    }
    
    return points;
  }

  // Update trajectory lines
  updateTrajectoryLines() {
    // Iterate backwards to safely remove items
    for (let i = this.trajectoryLines.length - 1; i >= 0; i--) {
      const traj = this.trajectoryLines[i];
      if (!traj.meteor.active) {
        // Remove trajectory when meteor is destroyed
        this.scene.remove(traj.line);
        this.trajectoryLines.splice(i, 1);
        continue;
      }
      
      // Update trajectory points
      const points = this.calculateTrajectory(traj.meteor);
      traj.line.geometry.setFromPoints(points);
    }
  }

  shootMeteor() {
    if (!this.cursor || !this.cursor.position) {
      console.warn('Cursor not initialized, cannot shoot meteor');
      return;
    }
    
    const speedEl = document.getElementById('speed');
    const speed = speedEl ? parseFloat(speedEl.value) : 0.05;
    const size = 10000; // 10,000 meters diameter (10km)
    const meteorGeo = new THREE.SphereGeometry(1, 16, 16);
    const meteorMat = new THREE.MeshStandardMaterial({ color:0x888888, metalness:0.2, roughness:0.5 });
    const meteor = new THREE.Mesh(meteorGeo, meteorMat);
    meteor.position.copy(this.camera.position);
    const dir = new THREE.Vector3().subVectors(this.cursor.position, this.camera.position).normalize();
    const density = 3000; // 3g/cm³ = 3000 kg/m³
    const volume = (4/3)*Math.PI*Math.pow(size/2,3);
    const mass = density * volume;
    const area = Math.PI * Math.pow(size/2,2);
  this.scene.add(meteor);
  const label = this.createLabel(`Meteor (${(size).toFixed(2)} m)`, meteor.position);
    const physVelocity = dir.clone().multiplyScalar(speed * this.SCENE_SCALE);
    
    // Fix scaling: size is diameter in meters, convert to scene units
    const radiusMeters = size / 2; // radius in meters
    const radiusScene = radiusMeters / this.SCENE_SCALE; // convert to scene units
    const visScale = Math.max(radiusScene, 1e-6); // avoid zero scale
    meteor.scale.setScalar(visScale);
    
    
    const meteorData = { 
      mesh: meteor, 
      velocity: dir.multiplyScalar(speed), 
      physVelocity, 
      active: true, 
      label, 
      mass, 
      area, 
      size,
      burning: false,
      burnIntensity: 0,
      entrySpeed: speed * this.SCENE_SCALE,
      energy: 0.5 * mass * Math.pow(speed * this.SCENE_SCALE, 2)
    };
    
    this.meteors.push(meteorData);
    this.lastMeteorData = meteorData;
    this.updateMeteorStats();
    
    // Create trajectory line
    this.createTrajectoryLine(meteorData);
  }

  // Update meteor stats display
  updateMeteorStats() {
    if (!this.lastMeteorData) return;
    
    const speed = document.getElementById('lastSpeed');
    const size = document.getElementById('lastSize');
    const mass = document.getElementById('lastMass');
    const energy = document.getElementById('lastEnergy');
    const status = document.getElementById('lastStatus');
    
    if (speed) speed.innerText = this.lastMeteorData.entrySpeed.toFixed(1);
    if (size) size.innerText = this.lastMeteorData.size.toFixed(2);
    if (mass) mass.innerText = this.lastMeteorData.mass.toFixed(0);
    if (energy) energy.innerText = this.lastMeteorData.energy.toExponential(2);
    if (status) status.innerText = this.lastMeteorData.active ? 'Active' : 'Impacted';
  }

  // Initialize map
  initMap() {
    this.mapCanvas = document.getElementById('impactMap');
    if (this.mapCanvas) {
      this.mapCtx = this.mapCanvas.getContext('2d');
      this.drawMap();
    }
  }

  // Convert 3D position to latitude/longitude
  positionToLatLon(position) {
    const x = position.x;
    const y = position.y;
    const z = position.z;
    
    // Convert to spherical coordinates
    const lat = Math.asin(y / Math.sqrt(x*x + y*y + z*z)) * 180 / Math.PI;
    const lon = Math.atan2(z, x) * 180 / Math.PI;
    
    return { lat: lat, lon: lon };
  }

  // Convert latitude/longitude to map coordinates
  latLonToMapCoords(lat, lon, canvasWidth, canvasHeight) {
    const x = (lon + 180) / 360 * canvasWidth;
    const y = (90 - lat) / 180 * canvasHeight;
    return { x: x, y: y };
  }

  // Draw the impact map
  drawMap() {
    if (!this.mapCtx) return;
    
    const canvas = this.mapCanvas;
    const ctx = this.mapCtx;
    
    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw Earth outline
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) / 2 - 10, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Draw impact locations
    this.impactLocations.forEach(impact => {
      const coords = this.latLonToMapCoords(impact.lat, impact.lon, canvas.width, canvas.height);
      
      // Size based on energy (kilotons)
      const size = Math.max(2, Math.min(20, Math.log10(impact.energy / 4.184e12 + 1) * 3));
      
      // Color based on energy
      const intensity = Math.min(1, Math.log10(impact.energy / 4.184e12 + 1) / 3);
      const red = Math.floor(255 * intensity);
      const green = Math.floor(255 * (1 - intensity));
      
      ctx.fillStyle = `rgb(${red}, ${green}, 0)`;
      ctx.beginPath();
      ctx.arc(coords.x, coords.y, size, 0, 2 * Math.PI);
      ctx.fill();
      
      // Draw ring for larger impacts
      if (impact.energy / 4.184e12 > 1) {
        ctx.strokeStyle = `rgb(${red}, ${green}, 0)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(coords.x, coords.y, size * 2, 0, 2 * Math.PI);
        ctx.stroke();
      }
    });
  }

  // Add impact to map
  addImpactToMap(position, energy) {
    const latLon = this.positionToLatLon(position);
    this.impactLocations.push({
      lat: latLon.lat,
      lon: latLon.lon,
      energy: energy,
      time: Date.now()
    });
    
    // Update map info
    const latEl = document.getElementById('impactLat');
    const lonEl = document.getElementById('impactLon');
    const energyEl = document.getElementById('mapEnergy');
    
    if (latEl) latEl.textContent = latLon.lat.toFixed(2);
    if (lonEl) lonEl.textContent = latLon.lon.toFixed(2);
    if (energyEl) energyEl.textContent = (energy / 4.184e12).toFixed(2);
    
    this.drawMap();
  }

  // Update statistics UI
  updateStatistics() {
    // FPS calculation
    this.frameCount++;
    const now = Date.now();
    if (now - this.lastFpsTime >= 1000) {
      this.currentFps = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime));
      this.frameCount = 0;
      this.lastFpsTime = now;
    }
    
    // Object count
    const objectCount = this.meteors.length + this.explosionEffects.length + this.impactEffects.length + this.trajectoryLines.length;
    
    // Memory usage (approximate)
    const memoryUsage = Math.round((performance.memory ? performance.memory.usedJSHeapSize : 0) / 1024 / 1024);
    
    // Update UI elements
    const fps = document.getElementById('fps');
    const objCount = document.getElementById('objectCount');
    const memUsage = document.getElementById('memoryUsage');
    const gravityMode = document.getElementById('gravityMode');
    const atmosphereMode = document.getElementById('atmosphereMode');
    const moonGravityMode = document.getElementById('moonGravityMode');
    const totalEnergy = document.getElementById('totalEnergy');
    const largestImpact = document.getElementById('largestImpact');
    const avgImpact = document.getElementById('avgImpact');
    
    if (fps) fps.textContent = this.currentFps;
    if (objCount) objCount.textContent = objectCount;
    if (memUsage) memUsage.textContent = memoryUsage;
    if (gravityMode) gravityMode.textContent = this.realistic ? 'Realistic' : 'Simple';
    if (atmosphereMode) atmosphereMode.textContent = this.showAtmosphere ? 'On' : 'Off';
    if (moonGravityMode) moonGravityMode.textContent = this.showMoon ? 'On' : 'Off';
    if (totalEnergy) totalEnergy.textContent = this.totalImpactEnergy.toExponential(2);
    if (largestImpact) largestImpact.textContent = (this.largestImpactEnergy / 4.184e12).toFixed(2); // Convert to kilotons
    if (avgImpact) avgImpact.textContent = this.impactCount > 0 ? (this.totalImpactEnergy / this.impactCount / 4.184e12).toFixed(2) : '0';
  }

  resetScene() {
    this.meteors.forEach(m=>{ if(m.mesh) this.scene.remove(m.mesh); if(m.label && m.label.element) m.label.element.remove(); });
    this.meteors = [];
    this.impactEffects.forEach(e=>{ if(e.mesh) this.scene.remove(e.mesh); });
    this.impactEffects = [];
    this.explosionEffects.forEach(e=>{ this.scene.remove(e.group); });
    this.explosionEffects = [];
    this.gravityVisualizers.forEach(v=>{ this.scene.remove(v.mesh); });
    this.gravityVisualizers = [];
    this.trajectoryLines.forEach(t=>{ this.scene.remove(t.line); });
    this.trajectoryLines = [];
    this.impactCount = 0; const ic = document.getElementById('impactCount'); if(ic) ic.innerText = '0';
    this.totalImpactEnergy = 0;
    this.largestImpactEnergy = 0;
    this.frameCount = 0;
    this.lastFpsTime = Date.now();
    this.currentFps = 60;
    this.lastMeteorData = null;
    this.updateMeteorStats();
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    
    // Skip updates if paused
    if (this.paused) {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      return;
    }
    
    // Pulse cursor
    const ringMesh = this.cursor && this.cursor.getObjectByName && this.cursor.getObjectByName('cursorRing');
    if(ringMesh){ const pulse = 1 + 0.1 * Math.sin(Date.now() * 0.005); this.cursor.scale.set(pulse,pulse,pulse); }
    // update aiming line
    const aimingLine = this.scene.getObjectByName && this.scene.getObjectByName('aimingLine');
    if(aimingLine){ const positions = aimingLine.geometry.attributes.position.array; positions[0]=this.camera.position.x; positions[1]=this.camera.position.y; positions[2]=this.camera.position.z; positions[3]=this.cursor.position.x; positions[4]=this.cursor.position.y; positions[5]=this.cursor.position.z; aimingLine.geometry.attributes.position.needsUpdate=true; }
    // update counters
    const mc = document.getElementById('meteorCount'); if(mc) mc.innerText = String(this.meteors.length);
    
    // update simulation time
    const currentTime = Date.now();
    const simTime = (currentTime - this.simulationStartTime) / 1000 * this.simSpeed;
    const st = document.getElementById('simTime'); if(st) st.innerText = simTime.toFixed(1);
    
    // update statistics
    this.updateStatistics();
    
    // predicted impact
    this.updatePredictedImpact();
    const mouseCursor = this.scene.getObjectByName('mouseCursor'); if(mouseCursor){ mouseCursor.position.copy(this.cursor.position); }
    
    // update moon orbit
    this.updateMoon();

    // update camera focus
    this.updateCameraFocus();

    // update gravity visualizers
    this.updateGravityVisualizers();

    // update explosion effects
    this.updateExplosionEffects();

    // update trajectory lines
    this.updateTrajectoryLines();

    // camera framing update (if active)
    if(this.cameraFrame && this.cameraFrame.active){
      const now = Date.now();
      const t = Math.min(1, (now - this.cameraFrame.startTime) / this.cameraFrame.duration);
      // lerp camera position
      this.camera.position.lerpVectors(this.cameraFrame.startCamPos, this.cameraFrame.endCamPos, t);
      // lerp controls target
      const newTarget = this.cameraFrame.startTarget.clone().lerp(this.cameraFrame.endTarget, t);
      this.controls.target.copy(newTarget);
      if(t >= 1) this.cameraFrame.active = false;
    }

    // Meteors update with atmosphere effects
    this.meteors.forEach(meteor=>{
      if(!meteor.active) return;
      const pos = meteor.mesh.position;
      const r = pos.length();
      const altitude = r * this.SCENE_SCALE - this.earthRadiusMeters;
      
      // Check if meteor should burn up in atmosphere
      if(altitude < this.atmosphereHeight && this.shouldBurnUp(meteor)) {
        if(!meteor.burning) {
          meteor.burning = true;
          this.createBurnEffect(meteor);
        }
        meteor.burnIntensity = Math.min(1, meteor.burnIntensity + 0.1 * this.simSpeed);
        
        // Gradually reduce meteor size due to burning
        const burnScale = 1 - (meteor.burnIntensity * 0.3);
        meteor.mesh.scale.setScalar(meteor.mesh.scale.x * burnScale);
        
        // Random chance of complete burn-up
        if(Math.random() < meteor.burnIntensity * 0.1 * this.simSpeed) {
          meteor.active = false;
          this.scene.remove(meteor.mesh);
          if(meteor.label && meteor.label.element && meteor.label.element.parentNode) {
            meteor.label.element.parentNode.removeChild(meteor.label.element);
          }
          const li = this.labels.indexOf(meteor.label); 
          if(li !== -1) this.labels.splice(li, 1);
          return;
        }
      }
      
      if(this.realistic){
        const posMeters = pos.clone().multiplyScalar(this.SCENE_SCALE);
        const vel = meteor.physVelocity.clone();
        const dt = 0.02 * this.simSpeed;
        
        // Earth gravity force (Newton's law of universal gravitation)
        const rmag = posMeters.length();
        const earthGravityForce = posMeters.clone().multiplyScalar(-this.G*this.earthMass/(rmag*rmag*rmag));
        
        // Moon gravity force
        const moonGravityForce = this.calculateMoonGravity(meteor);
        
        // Meteor-to-meteor gravity forces
        let meteorGravityForce = new THREE.Vector3(0, 0, 0);
        this.meteors.forEach(otherMeteor => {
          if (otherMeteor !== meteor && otherMeteor.active) {
            meteorGravityForce.add(this.calculateMeteorGravity(meteor, otherMeteor));
          }
        });
        
        // Atmospheric drag force
        const dragForce = this.calculateDragForce(meteor);
        
        // Apply forces (F = ma, so a = F/m)
        const totalForce = earthGravityForce.add(moonGravityForce).add(meteorGravityForce).add(dragForce);
        const acceleration = totalForce.divideScalar(meteor.mass);
        
        meteor.physVelocity.add(acceleration.multiplyScalar(dt));
        posMeters.add(meteor.physVelocity.clone().multiplyScalar(dt));
        meteor.mesh.position.copy(posMeters.multiplyScalar(1/this.SCENE_SCALE));
        if(meteor.label) meteor.label.position.copy(meteor.mesh.position);
      } else {
        // Enhanced simple mode physics with proper gravity
        const gravityAccel = pos.clone().normalize().multiplyScalar(-this.gravityStrength/(r*r));
        
        // Add moon gravity in simple mode
        const moon = this.scene.getObjectByName('moon');
        if (moon) {
          const moonPos = moon.position.clone();
          const toMoon = moonPos.sub(pos);
          const moonDist = toMoon.length();
          if (moonDist > 0.1) { // Avoid division by zero
            const moonGravityStrength = 0.001; // Simplified moon gravity
            const moonGravityAccel = toMoon.normalize().multiplyScalar(moonGravityStrength / (moonDist * moonDist));
            meteor.velocity.add(moonGravityAccel.multiplyScalar(this.simSpeed));
          }
        }
        
        // Add atmospheric drag in simple mode
        if(altitude < this.atmosphereHeight) {
          const dragAccel = meteor.velocity.clone().normalize().multiplyScalar(-0.01 * this.simSpeed);
          meteor.velocity.add(dragAccel);
        }
        
        // Apply gravity acceleration
        meteor.velocity.add(gravityAccel.multiplyScalar(this.simSpeed));
        
        // Update position
        pos.add(meteor.velocity.clone().multiplyScalar(this.simSpeed));
        
        // Update label position
        if(meteor.label) meteor.label.position.copy(meteor.mesh.position);
      }
      
      if(r < this.earthRadius + 0.2){
        meteor.active = false;
        this.createImpact(pos.clone());
        
        // Create explosion effect
        try{
          let speedAtImpact = meteor.physVelocity ? meteor.physVelocity.length() : (meteor.velocity ? meteor.velocity.length()*this.SCENE_SCALE : 0);
          const ke = 0.5 * (meteor.mass || 1) * speedAtImpact * speedAtImpact;
          this.createExplosion(pos.clone(), ke);
          
          const keTons = ke / 4.184e9;
          const ie = document.getElementById('impactEnergy'); if(ie) ie.innerText = `${ke.toExponential(3)} J (~${keTons.toFixed(2)} kt)`;
          
          // Update statistics
          this.totalImpactEnergy += ke;
          this.largestImpactEnergy = Math.max(this.largestImpactEnergy, ke);
          this.impactCount++;
        }catch(e){ console.error('impact energy calc', e); const ie = document.getElementById('impactEnergy'); if(ie) ie.innerText = '-'; }
        
        this.scene.remove(meteor.mesh);
        if(meteor.label && meteor.label.element && meteor.label.element.parentNode) meteor.label.element.parentNode.removeChild(meteor.label.element);
        const li = this.labels.indexOf(meteor.label); if(li!==-1) this.labels.splice(li,1);
        this.impactCount++; const ic = document.getElementById('impactCount'); if(ic) ic.innerText = String(this.impactCount);
        
        // Update stats
        this.updateMeteorStats();
      }
    });

    // impact effects and burn effects
    this.impactEffects.forEach(effect => {
      if (effect.type === 'burn') {
        effect.lifetime -= 0.02 * this.simSpeed;
        effect.mesh.material.opacity = Math.max(0, effect.lifetime * 1.6);
        if (effect.lifetime <= 0) {
          this.scene.remove(effect.mesh);
        }
      } else {
        effect.mesh.scale.addScalar(0.05 * this.simSpeed);
        effect.mesh.material.opacity -= 0.02 * this.simSpeed;
        if (effect.mesh.material.opacity <= 0) {
          this.scene.remove(effect.mesh);
        }
      }
    });
    this.impactEffects = this.impactEffects.filter(e => 
      e.mesh.material.opacity > 0 && (e.type !== 'burn' || e.lifetime > 0)
    );

    this.meteors = this.meteors.filter(m=>m.active);

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  }

  updatePredictedImpact(){
    const speed = parseFloat(document.getElementById('speed')?.value || 0.05);
    const origin = this.camera.position.clone();
    const dir = this.cursor.position.clone().sub(this.camera.position).normalize();
    let pos = origin.clone();
    let v = dir.multiplyScalar(speed);
    let hitPos = null;
    // simple ballistic (scene units)
    const dt = 0.02 * this.simSpeed;
    const steps = 2000;
    for(let i=0;i<steps;i++){
      const r = pos.length();
      const accel = pos.clone().normalize().multiplyScalar(-this.gravityStrength/(r*r));
      v.add(accel.multiplyScalar(dt));
      pos.add(v.clone().multiplyScalar(dt));
      if(pos.length() < this.earthRadius + 0.2){ hitPos = pos.clone(); break; }
      if(pos.length() > 1e4) break;
    }
    if(hitPos){ this.predictedImpactMarker.position.copy(hitPos); this.predictedImpactMarker.visible = true; } else { this.predictedImpactMarker.visible = false; }
  }

  createImpact(position){
    const normal = position.clone().normalize();
    const geo = new THREE.RingGeometry(0.1,0.2,32);
    const mat = new THREE.MeshBasicMaterial({ color:0xff0000, side:THREE.DoubleSide, transparent:true, opacity:0.8 });
    const ring = new THREE.Mesh(geo, mat);
    const quat = new THREE.Quaternion();
    quat.setFromUnitVectors(new THREE.Vector3(0,1,0), normal);
    ring.quaternion.copy(quat);
    ring.position.copy(normal.multiplyScalar(this.earthRadius+0.01));
    this.scene.add(ring);
    this.impactEffects.push({ mesh:ring });
  }

  // NASA fetchers kept as-is but bound to this
  async fetchAsteroidList(loadMore=false){
    const apiKey = document.getElementById('apiKey')?.value.trim();
    if(!apiKey) return alert('Enter NASA API key');
    if(!loadMore) { this.neoPage = 0; this.asteroidList = []; document.getElementById('asteroidSelect').innerHTML = ''; }
    try{
      const res = await fetch(`https://api.nasa.gov/neo/rest/v1/neo/browse?page=${this.neoPage||0}&size=20&api_key=${apiKey}`);
      const data = await res.json();
      const select = document.getElementById('asteroidSelect');
      data.near_earth_objects.forEach(a=>{
        this.asteroidList = this.asteroidList || [];
        this.asteroidList.push(a);
        
        // Calculate mid-size for display
        const minSize = a.estimated_diameter.meters.estimated_diameter_min;
        const maxSize = a.estimated_diameter.meters.estimated_diameter_max;
        const midSize = (minSize + maxSize) / 2;
        
        const option = document.createElement('option'); 
        option.value = a.id; 
        option.textContent = `${a.name} (${midSize.toFixed(0)} m mid-size)`; 
        select.appendChild(option);
      });
      this.neoPage = (this.neoPage||0) + 1;
      document.getElementById('asteroidData').innerHTML = `Fetched ${this.asteroidList.length} asteroids (page ${this.neoPage})`;
    }catch(err){ console.error(err); alert('Error fetching asteroids'); }
  }

  async fetchAsteroidDetails(id){
    const apiKey = document.getElementById('apiKey')?.value.trim(); if(!apiKey) return null;
    try{ const res = await fetch(`https://api.nasa.gov/neo/rest/v1/neo/${id}?api_key=${apiKey}`); return await res.json(); }catch(err){ console.error(err); return null; }
  }

  async spawnSelectedAsteroid(){
    const select = document.getElementById('asteroidSelect'); 
    if(!select.value) return alert('Select an asteroid');
    
    const details = await this.fetchAsteroidDetails(select.value) || (this.asteroidList||[]).find(a=>a.id===select.value);
    if(!details) return alert('Could not fetch asteroid details');
    
    // Calculate mid-size from min and max diameter
    const minSize = details.estimated_diameter.meters.estimated_diameter_min;
    const maxSize = details.estimated_diameter.meters.estimated_diameter_max;
    const midSize = (minSize + maxSize) / 2;
    
    const approach = parseFloat(details.close_approach_data[0].miss_distance.kilometers);
    const velocity = parseFloat(details.close_approach_data[0].relative_velocity.kilometers_per_second);
    
    // Calculate realistic mass and properties
    const density = 3000; // kg/m³ - typical asteroid density
    const volume = (4/3) * Math.PI * Math.pow(midSize/2, 3);
    const mass = density * volume;
    const area = Math.PI * Math.pow(midSize/2, 2);
    
    // Update UI with detailed information
    document.getElementById('asteroidData').innerHTML = `
      <b>${details.name}</b><br>
      Min Diameter: ${minSize.toFixed(1)} m<br>
      Max Diameter: ${maxSize.toFixed(1)} m<br>
      <b>Mid Diameter: ${midSize.toFixed(1)} m</b><br>
      Miss distance: ${approach.toFixed(0)} km<br>
      Velocity: ${velocity.toFixed(1)} km/s<br>
      Mass: ${(mass/1000).toFixed(1)} tons
    `;
    
    // Create meteor mesh
    const meteorGeo = new THREE.SphereGeometry(1, 16, 16);
    const meteorMat = new THREE.MeshStandardMaterial({ 
      color: 0xaaaaaa, 
      metalness: 0.1, 
      roughness: 0.6 
    });
    const meteor = new THREE.Mesh(meteorGeo, meteorMat);
    
    // Position meteor closer to Earth (reduce approach distance by 90%)
    const approachMeters = (approach * 1000) * 0.1; // Much closer
    meteor.position.set(0, 0, approachMeters / this.SCENE_SCALE);
    
    // Scale meteor to actual size - fix scaling to match Earth size
    const radiusMeters = midSize / 2; // radius in meters
    const radiusScene = radiusMeters / this.SCENE_SCALE; // convert to scene units
    meteor.scale.setScalar(Math.max(radiusScene, 1e-6));
    
  this.scene.add(meteor);
    const label = this.createLabel(`${details.name} (${midSize.toFixed(0)} m)`, meteor.position);
    
    // Frame camera to the spawned meteor
    try{
      const distanceMeters = Math.max(midSize * 10, 1000);
      const distanceScene = distanceMeters / this.SCENE_SCALE;
      const meteorWorldPos = meteor.position.clone();
      const endCamPos = meteorWorldPos.clone().add(new THREE.Vector3(0, distanceScene * 0.7, distanceScene * 1.2));
      this.frameCameraTo(meteorWorldPos, endCamPos, 1200);
    } catch(e) { 
      console.warn('Framing failed', e); 
    }
    
    // Convert velocity to scene units and create physics velocity
    const dir = new THREE.Vector3(0, 0, -1).normalize();
    const sceneVelocity = dir.multiplyScalar(velocity / 50); // Convert km/s to scene units
    const physVelocity = dir.clone().multiplyScalar(velocity * 1000); // m/s for physics
    
    // Add meteor with all properties
    const asteroidData = { 
      mesh: meteor, 
      velocity: sceneVelocity, 
      physVelocity: physVelocity, 
      active: true, 
      mass, 
      area, 
      size: midSize,
      burning: false,
      burnIntensity: 0,
      label,
      asteroidData: details, // Store original asteroid data
      entrySpeed: velocity * 1000, // m/s
      energy: 0.5 * mass * Math.pow(velocity * 1000, 2)
    };
    
    this.meteors.push(asteroidData);
    this.lastMeteorData = asteroidData;
    this.updateMeteorStats();
    
    // Create trajectory line
    this.createTrajectoryLine(asteroidData);
  }

  loadHighResEarthTexture(){
    // First ask user for a USGS (or other) URL to prioritize
    const userUrl = window.prompt('Enter a USGS or remote Earth texture URL (leave blank to use defaults):', '');
    const urls = [];
    if(userUrl && userUrl.trim()) urls.push(userUrl.trim());
    // defaults (NASA Blue Marble, then fallback world map)
    urls.push('https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57730/land_ocean_ice_2012044_lrg.jpg');
    urls.push('https://upload.wikimedia.org/wikipedia/commons/8/80/World_map_-_low_resolution.svg');
    const loader = new THREE.TextureLoader();
    let tried = 0;
    const tryLoad = ()=>{
      if(tried>=urls.length) return alert('All texture loads failed (CORS or network)');
      const url = urls[tried++];
      loader.load(url, tex=>{
        const earth = this.scene.children.find(c=>c.geometry && c.geometry.type==='SphereGeometry');
        if(earth && earth.material){
            // ensure material doesn't tint the incoming texture (avoid black-looking map)
            if(earth.material.color) earth.material.color.setHex(0xffffff);
            tex.encoding = THREE.sRGBEncoding;
            tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = true;
            earth.material.map = tex;
            earth.material.needsUpdate = true;
          }
      }, undefined, err=>{ console.warn('Texture load failed', url, err); tryLoad(); });
    };
    tryLoad();
  }

  onWindowResize(){ if(!this.camera||!this.renderer) return; this.camera.aspect = window.innerWidth/window.innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(window.innerWidth, window.innerHeight); }
}

const app = new App();
app.init();
app.animate();

// expose for debugging
window.app = app;
