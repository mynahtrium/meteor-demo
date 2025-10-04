import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Preload explosion texture for sprite clouds
let explosionTexture = null;
const explosionTextureUrl = 'explosion_sprite.png'; // Save the provided image as this file in project root
const loader = new THREE.TextureLoader();
loader.load(explosionTextureUrl, tex => { explosionTexture = tex; }, undefined, err => { console.warn('explosion texture load failed', err); });
// Preload meteor surface texture (use the attached crater-like image)
let meteorTexture = null;
const meteorTextureUrl = 'meteor_texture.png';
loader.load(meteorTextureUrl, tex => { tex.encoding = THREE.sRGBEncoding; tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1,1); meteorTexture = tex; console.debug('meteor texture loaded'); }, undefined, err => { console.warn('meteor texture load failed', err); });

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
    this._lastFrameTime = null;
    // camera shake state
    this.cameraShake = { amplitude: 0, decay: 0.95, frequency: 20, time: 0 };
  }

  // Rough deterministic land/ocean test: use spherical coordinates and a noise-ish function
  // This is a fast heuristic for visualization only (doesn't use real Earth data).
  isOceanAt(position){
    if(!position || !position.length) return true;
    const p = position.clone().normalize();
    // latitude = asin(y)
    const lat = Math.asin(p.y);
    const lon = Math.atan2(p.z, p.x);
    // a cheap periodic function to mimic continents/oceans
    const v = Math.sin(lat * 3.0 + Math.cos(lon * 2.0)) * 0.5 + Math.sin(lon * 1.5) * 0.2;
    // bias toward ocean slightly
    const ocean = v < 0.12;
    return ocean;
  }

  // Very small region name heuristic: converts 3D position to lat/lon and returns a coarse region string
  _regionNameFromPosition(position){
    const p = position.clone().normalize();
    const lat = Math.asin(p.y) * 180 / Math.PI; // degrees
    const lon = Math.atan2(p.z, p.x) * 180 / Math.PI;
    // coarse buckets
    const latBand = lat > 60 ? 'Arctic' : (lat < -60 ? 'Antarctic' : (lat > 20 ? 'Northern' : (lat < -20 ? 'Southern' : 'Equatorial')));
    const lonBand = (lon+180) < 120 ? ((lon+180) < 60 ? 'Americas' : 'Atlantic/Europe/Africa') : 'Asia/Oceania';
    return `${latBand} ${lonBand}`;
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
    try{
      // Attach the renderer canvas to #app-root if available, otherwise to body
      const appRoot = document.getElementById('app-root');
      if(appRoot){
        appRoot.style.position = 'fixed'; appRoot.style.left = '0'; appRoot.style.top = '0'; appRoot.style.right = '0'; appRoot.style.bottom = '0'; appRoot.style.zIndex = '1';
        appRoot.appendChild(this.renderer.domElement);
      } else {
        document.body.appendChild(this.renderer.domElement);
      }
      // ensure the canvas fills the screen and sits behind UI overlays
      const canvas = this.renderer.domElement;
      canvas.style.position = 'fixed'; canvas.style.left = '0'; canvas.style.top = '0'; canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.zIndex = '0';
      // set device pixel ratio for crisp rendering
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      console.debug('Renderer initialized', {width: this.renderer.domElement.width, height: this.renderer.domElement.height, pixelRatio: this.renderer.getPixelRatio()});
      // quick WebGL context check
      const gl = this.renderer.getContext && this.renderer.getContext();
      if(!gl){
        this.showErrorOverlay('WebGL not available: your browser or GPU may not support WebGL.');
        return;
      }
    }catch(e){
      console.error('Renderer append failed', e);
      this.showErrorOverlay('Failed to initialize WebGL renderer: ' + (e && e.message));
      return;
    }

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
  // wire meteor size UI
  const ms = el('meteorSize'); if(ms){ const mv = el('meteorSizeVal'); mv.innerText = ms.value; ms.oninput = (e)=>{ if(mv) mv.innerText = parseFloat(e.target.value).toFixed(1); }; }
    if (el('loadMore')) el('loadMore').onclick = () => this.fetchAsteroidList(true);
  const moreBtn = el('moreBigMeteors'); if(moreBtn) moreBtn.onclick = (e) => { this.moreBigMeteors = !this.moreBigMeteors; e.target.innerText = `More Big Meteors: ${this.moreBigMeteors? 'On' : 'Off'}`; };
  const spawnBig = el('spawnBigMeteor'); if(spawnBig) spawnBig.onclick = ()=>{ this.spawnRandomBigMeteor(); };
    if (el('highResTex')) el('highResTex').onclick = () => this.loadHighResEarthTexture();
  // focus / spawn buttons
  if(el('focusTarget')) el('focusTarget').onclick = ()=>{ const b = document.getElementById('targetBody').value; this.createMoonAndSun(); this.focusOnBody(b); };
  if(el('spawnAtTarget')) el('spawnAtTarget').onclick = ()=>{ const b = document.getElementById('targetBody').value; this.createMoonAndSun(); this.spawnAtBody(b); };
  // aerodynamic effects toggle
  const aeroEl = document.getElementById('showAeroEffects'); if(aeroEl) aeroEl.onchange = (e)=>{ this.showAero = !!e.target.checked; };
  // Windows 98 click sound initializer
  try{ this.initClickSound(); }catch(e){ }
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

  spawnRandomBigMeteor(){
    // spawn a meteor with diameter between 5 and 80 meters
    const size = 5 + Math.random() * 75;
    const speed = parseFloat(document.getElementById('speed')?.value || 0.05);
    const meteorGeo = new THREE.SphereGeometry(1, 16, 16);
  const meteorMat = new THREE.MeshStandardMaterial({ color:0x886644, metalness:0.2, roughness:0.6 });
  if(meteorTexture) { meteorMat.map = meteorTexture; meteorMat.needsUpdate = true; }
    const meteor = new THREE.Mesh(meteorGeo, meteorMat);
    meteor.position.copy(this.camera.position);
    const dir = new THREE.Vector3().subVectors(this.cursor.position, this.camera.position).normalize();
    const density = 3000; const volume = (4/3)*Math.PI*Math.pow(size/2,3); const mass = density*volume; const area = Math.PI*Math.pow(size/2,2);
    const physVelocity = dir.clone().multiplyScalar(speed * this.SCENE_SCALE);
  const meterToScene = 1 / this.SCENE_SCALE; const radiusScene = (size / 2) * meterToScene; const visScale = Math.max(radiusScene * this.meteorVisualScale, 1e-6);
  meteor.scale.setScalar(visScale);
    this.scene.add(meteor);
    const label = this.createLabel(`Big Meteor (${size.toFixed(1)} m)`, meteor.position);
    this.meteors.push({ mesh:meteor, velocity:dir.multiplyScalar(speed), physVelocity, active:true, label, mass, area, size });
  }

  showErrorOverlay(msg){
    try{
      // remove existing overlay
      const prev = document.getElementById('error-overlay'); if(prev) prev.remove();
      const ov = document.createElement('div'); ov.id = 'error-overlay';
      ov.style.position = 'fixed'; ov.style.left = '0'; ov.style.top = '0'; ov.style.right = '0'; ov.style.bottom = '0';
      ov.style.background = 'linear-gradient(180deg, rgba(0,0,0,0.85), rgba(0,0,0,0.95))'; ov.style.color = '#fff';
      ov.style.zIndex = '9999'; ov.style.display='flex'; ov.style.flexDirection='column'; ov.style.alignItems='center'; ov.style.justifyContent='center';
      ov.style.fontFamily = 'sans-serif';
      ov.innerHTML = `<div style="max-width:820px;padding:20px;background:#111;border-radius:8px;text-align:left;"><h2 style='margin:0 0 8px'>Renderer failed to initialize</h2><div style='opacity:0.9;margin-bottom:12px'>${msg}</div><div>Try the following:</div><ul><li>Use a modern browser (Chrome, Edge, Firefox)</li><li>Enable WebGL or update graphics drivers</li><li>Check browser console for errors (F12)</li></ul><div style='margin-top:14px'><button id='reloadPage' style='padding:8px 12px'>Reload</button></div></div>`;
      document.body.appendChild(ov);
      document.getElementById('reloadPage').onclick = () => location.reload();
    }catch(e){ console.error('Could not show overlay', e); }
  }

  initClickSound(){
    try{
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }catch(e){ console.warn('Audio init failed', e); }
  }

  playClick(){
    try{
      if(!this.audioCtx) this.initClickSound();
      const ctx = this.audioCtx;
      // Windows XP-like click: short combined tones
      const o1 = ctx.createOscillator(); const o2 = ctx.createOscillator();
      const g = ctx.createGain();
      o1.type='sine'; o1.frequency.value = 880; o2.type='sine'; o2.frequency.value = 1320;
      g.gain.value = 0.0001; o1.connect(g); o2.connect(g); g.connect(ctx.destination);
      const now = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.25, now + 0.008);
      g.gain.linearRampToValueAtTime(0.001, now + 0.12);
      o1.start(now); o2.start(now); o1.stop(now + 0.14); o2.stop(now + 0.14);
    }catch(e){ /* ignore audio errors */ }
  }

  // initialize explosion particle storage
  initExplosionSystem(){
    this.explosions = [];
  }

  // --- Solar system feature (compact, decorative) ---
  createSolarSystem(){
    if(this.solarGroup) return; // already created
    this.solarGroup = new THREE.Group();
    this.solarGroup.name = 'solarGroup';

    // Sun (emissive sphere)
    const sunGeo = new THREE.SphereGeometry(0.5, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffdd66 });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.name = 'Sun';
    this.solarGroup.add(sunMesh);

    // Planets array with simple orbital parameters (distance, size, speed)
    const planets = [
      { name: 'Mercury', dist: 1.0, size: 0.03, speed: 0.04, color: 0xaaaaaa },
      { name: 'Venus', dist: 1.6, size: 0.05, speed: 0.02, color: 0xffcc99 },
      { name: 'Earth', dist: 2.2, size: 0.06, speed: 0.015, color: 0x3366ff },
      { name: 'Mars', dist: 2.8, size: 0.04, speed: 0.012, color: 0xff6633 },
      { name: 'Jupiter', dist: 4.0, size: 0.18, speed: 0.007, color: 0xffaa66 },
      { name: 'Saturn', dist: 5.5, size: 0.14, speed: 0.005, color: 0xffddcc }
    ];

    this.solarPlanets = [];
    planets.forEach(p=>{
      const g = new THREE.Group();
      g.name = p.name + '_orbit';
      const geo = new THREE.SphereGeometry(p.size, 16, 16);
      const mat = new THREE.MeshStandardMaterial({ color: p.color, metalness:0.1, roughness:0.8 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p.dist, 0, 0);
      g.add(mesh);
      // optional ring for orbit path
      const ringGeo = new THREE.RingGeometry(p.dist - 0.005, p.dist + 0.005, 64);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x888888, side: THREE.DoubleSide, transparent:true, opacity:0.25 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI/2;
      this.solarGroup.add(ring);

      this.solarGroup.add(g);
      this.solarPlanets.push({ group:g, mesh, speed:p.speed, dist:p.dist });
    });

    // place solar group off to the side so it doesn't overlap with Earth in the main scene
    this.solarGroup.position.set(-6, 2, -8);
    this.scene.add(this.solarGroup);
    this.solarVisible = true;
  }

  // Create Moon and Sun objects for focused interactions
  createMoonAndSun(){
    if(this.moon) return;
    // Moon: small grey sphere orbiting Earth
    const moonGeo = new THREE.SphereGeometry(0.173, 24, 24); // scaled roughly
    const moonMat = new THREE.MeshStandardMaterial({ color:0xaaaaaa });
    this.moon = new THREE.Mesh(moonGeo, moonMat);
    this.moon.position.set(0, 0.384, 0.92); // offset in scene units
    this.scene.add(this.moon);

    // Sun: emissive sphere placed far away for lighting and focusing
    const sunGeo = new THREE.SphereGeometry(0.6, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color:0xffee88 });
    this.sun = new THREE.Mesh(sunGeo, sunMat);
    this.sun.position.set(12, 6, -10);
    this.scene.add(this.sun);

    // directional sunlight
    if(!this.sunLight){ this.sunLight = new THREE.DirectionalLight(0xfff3d9, 1.2); this.sunLight.position.copy(this.sun.position); this.scene.add(this.sunLight); }
  }

  focusOnBody(name){
    if(name === 'Moon' && this.moon){ this.frameCameraTo(this.moon.position.clone(), this.moon.position.clone().add(new THREE.Vector3(0,0.6,1.4)), 800); }
    else if(name === 'Sun' && this.sun){ this.frameCameraTo(this.sun.position.clone(), this.sun.position.clone().add(new THREE.Vector3(0,0.6,1.8)), 800); }
    else if(name === 'Earth'){ this.frameCameraTo(new THREE.Vector3(0, this.earthRadius + 0.5, 0), new THREE.Vector3(0, this.earthRadius + 3, 8), 800); }
  }

  spawnAtBody(name){
    // Spawns a meteor directed at the chosen body: camera is placed near the body and meteor spawns from camera toward body center
    if(name === 'Moon' || name === 'Sun'){
      const target = name === 'Moon' ? this.moon : this.sun;
      if(!target) return;
      // place camera near the target and shoot inward
      const camPos = target.position.clone().add(new THREE.Vector3(0, 0.5, 1.2));
      this.camera.position.copy(camPos);
      this.controls.target.copy(target.position);
      // create meteor and aim at target
      const size = 10 + Math.random()*40;
      const meteorGeo = new THREE.SphereGeometry(1, 16, 16);
      const meteorMat = new THREE.MeshStandardMaterial({ color:0x777777, metalness:0.2, roughness:0.6 }); if(meteorTexture) meteorMat.map = meteorTexture;
      const meteor = new THREE.Mesh(meteorGeo, meteorMat);
      meteor.position.copy(this.camera.position);
      const dir = target.position.clone().sub(this.camera.position).normalize();
      const physVelocity = dir.clone().multiplyScalar(20000);
      const density = 3000; const volume = (4/3)*Math.PI*Math.pow(size/2,3); const mass = density*volume; const area = Math.PI*Math.pow(size/2,2);
      const meterToScene = 1/this.SCENE_SCALE; const radiusScene = (size/2) * meterToScene; meteor.scale.setScalar(Math.max(radiusScene*this.meteorVisualScale, 1e-6));
      this.scene.add(meteor);
      this.meteors.push({ mesh:meteor, velocity:dir.multiplyScalar(0.02), physVelocity, active:true, mass, area, size });
    }
  }

  // Simple moon crater placement: add a few sprite decals on the moon surface
  _ensureMoonCraters(){
    if(!this.moon) return;
    if(this._moonCratersAdded) return;
    this._moonCratersAdded = true;
    const craterTex = new THREE.TextureLoader().load('meteor_texture.png');
    for(let i=0;i<24;i++){
      const s = new THREE.SpriteMaterial({ map: craterTex, transparent:true, opacity:0.9 });
      const sp = new THREE.Sprite(s); const u = Math.random()*2*Math.PI; const v = Math.acos(2*Math.random()-1)-Math.PI/2;
      const r = this.moon.geometry.parameters.radius * 1.001;
      const pos = new THREE.Vector3(Math.cos(u)*Math.cos(v), Math.sin(v), Math.sin(u)*Math.cos(v)).multiplyScalar(r);
      sp.position.copy(pos);
      const scale = 0.02 + Math.random()*0.08; sp.scale.setScalar(scale);
      this.moon.add(sp);
    }
  }

  destroySolarSystem(){
    if(!this.solarGroup) return;
    this.solarPlanets = [];
    this.scene.remove(this.solarGroup);
    this.solarGroup.traverse(obj=>{ if(obj.geometry) obj.geometry.dispose(); if(obj.material) { if(obj.material.map) obj.material.map.dispose(); obj.material.dispose(); } });
    this.solarGroup = null;
    this.solarVisible = false;
  }

  toggleSolarSystem(e){
    if(!this.solarGroup){ this.createSolarSystem(); if(e && e.target) e.target.innerText = 'Hide Solar System'; }
    else { this.destroySolarSystem(); if(e && e.target) e.target.innerText = 'Show Solar System'; }
  }

  updateSolarSystem(){
    if(!this.solarGroup || !this.solarPlanets) return;
    const t = Date.now() * 0.001 * this.simSpeed;
    this.solarPlanets.forEach(p=>{
      // rotate the orbit group to advance the planet
      p.group.rotation.y = t * p.speed;
      // small axial spin
      if(p.mesh) p.mesh.rotation.y += 0.01 * this.simSpeed;
    });
    // subtle sun glow: scale pulse
    const sun = this.solarGroup.getObjectByName('Sun'); if(sun) sun.scale.setScalar(1 + 0.04 * Math.sin(t*2));
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
    const sizeEl = document.getElementById('meteorSize');
    const size = sizeEl ? parseFloat(sizeEl.value) : 0.5;
  // create a textured, irregular 3D meteor mesh sized according to `size` (meters)
  const meteor = this.createMeteorMesh(size);
  meteor.position.copy(this.camera.position);
    const dir = new THREE.Vector3().subVectors(this.cursor.position, this.camera.position).normalize();
    // If we have a predicted impact marker, aim directly at that point so meteors go toward the globe
    if(this.predictedImpactMarker && this.predictedImpactMarker.visible){
      dir.copy(this.predictedImpactMarker.position).sub(meteor.position).normalize();
    }
    const density = 3000;
    const size = 10000; // 10,000 meters diameter (10km)
    const meteorGeo = new THREE.SphereGeometry(1, 16, 16);
  const meteorMat = new THREE.MeshStandardMaterial({ color:0x888888, metalness:0.2, roughness:0.5 });
  if(meteorTexture){ meteorMat.map = meteorTexture; meteorMat.needsUpdate = true; }
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
    // Convert meters -> scene units. Geometry radius is 1 (1 meter), so to represent
    // a meteor with diameter `size` (meters) we scale by radius = size/2 in meters.
    const meterToScene = 1 / this.SCENE_SCALE;
    const radiusScene = (size / 2) * meterToScene;
  // scale is handled inside createMeteorMesh; ensure minimal visibility if necessary
    // Give meteors a TTL and make their scene velocity slightly slower so they don't fly into space
    const sceneVelocity = dir.clone().multiplyScalar(speed * 0.6);
    meteor.material.transparent = true; meteor.material.opacity = 1.0;
    // give a small random angular velocity so meteors tumble in flight
    const angVel = new THREE.Vector3((Math.random()-0.5)*2, (Math.random()-0.5)*2, (Math.random()-0.5)*2).multiplyScalar(0.6);
    this.meteors.push({ mesh:meteor, velocity:sceneVelocity, physVelocity, active:true, label, mass, area, size, ttl: 800, fading:false, angularVelocity: angVel });
  }

  // Create a textured meteor mesh as a smooth sphere and apply meteor_texture.jpg as its material map.
  // sizeMeters is diameter in meters.
  createMeteorMesh(sizeMeters){
  // smooth sphere geometry for a ball-like meteor (increased resolution for crisper craters)
  const widthSeg = 96; // was 48
  const heightSeg = 64; // was 32
  const geom = new THREE.SphereGeometry(1, widthSeg, heightSeg);

    // create a PBR-friendly material; we'll set the map when the texture loads
    const mat = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:0.9, metalness:0.02, transparent:true });
    const mesh = new THREE.Mesh(geom, mat);

    // try to load an external meteor texture image located at project root
    const loader = new THREE.TextureLoader();
    loader.load('meteor_texture.jpg', (tex)=>{
      try{
        const img = tex.image;
        // helper to apply crater-like inward domes by sampling the image at each vertex UV
        // and bake a normal map from the processed brightness map for better lighting
        const applyCratersFromImage = (image)=>{
          try{
            const w = image.width, h = image.height;
            const cvs = document.createElement('canvas'); cvs.width = w; cvs.height = h;
            const ctx = cvs.getContext('2d');
            ctx.drawImage(image, 0, 0, w, h);
            // lightly darken for visual consistency
            ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(0,0,w,h);
            const srcImg = ctx.getImageData(0,0,w,h);

            // crater sculpting parameters (unit-sphere space)
            // user requested deeper craters here
            const maxDepth = 0.09; // increased depth for more pronounced, but still controlled, inward domes
            const thresholdLow = 0.20; // darkness threshold where crater starts
            const thresholdHigh = 0.75; // darkness where crater is strongest
            const blurRadiusPx = Math.max(2, Math.floor(Math.min(w,h) * 0.02)); // slightly larger blur for smoother domes

            const posAttr = geom.attributes.position;
            const uvAttr = geom.attributes.uv;
            if(!uvAttr) return null;

            // smoothstep helper
            const smoothstep = (edge0, edge1, x) => {
              const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
              return t * t * (3 - 2 * t);
            };

            // build a blurred height map (brightness -> height) using a box blur; height = darkness
            const height = new Float32Array(w*h);
            const r = blurRadiusPx;
            for(let py=0; py<h; py++){
              for(let px=0; px<w; px++){
                let sum = 0, count = 0;
                for(let oy=-r; oy<=r; oy++){
                  const sy = Math.min(h-1, Math.max(0, py + oy));
                  for(let ox=-r; ox<=r; ox++){
                    const sx = Math.min(w-1, Math.max(0, px + ox));
                    const idx = (sy * w + sx) * 4;
                    const rr = srcImg.data[idx], gg = srcImg.data[idx+1], bb = srcImg.data[idx+2];
                    sum += (rr + gg + bb) / 3;
                    count++;
                  }
                }
                const avg = (sum / count) / 255.0;
                height[py*w + px] = 1.0 - avg; // darkness as height (0..1)
              }
            }

            // use the height map to displace vertices inward by a smooth dome amount
            for(let i=0;i<posAttr.count;i++){
              const u = uvAttr.getX(i);
              const v = uvAttr.getY(i);
              // nearest pixel sample from blurred height
              const cx = Math.floor(u * (w - 1));
              const cy = Math.floor((1 - v) * (h - 1));
              const hval = height[cy * w + cx] || 0;
              // crater strength derived from height with smoothstep thresholding
              const craterStrength = smoothstep(thresholdLow, thresholdHigh, hval);
              if(craterStrength <= 0) continue;

              // get current vertex and normal (on unit sphere approximation)
              const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
              const norm = new THREE.Vector3(x, y, z).normalize();

              // displace only inward (toward center) scaled by craterStrength
              const disp = craterStrength * maxDepth;
              const newPos = norm.clone().multiplyScalar(1 - disp);
              posAttr.setXYZ(i, newPos.x, newPos.y, newPos.z);
            }

            posAttr.needsUpdate = true;
            geom.computeVertexNormals();

            // produce final canvas texture (we reuse the canvas we drew into earlier)
            const finalTex = new THREE.CanvasTexture(cvs);
            finalTex.encoding = THREE.sRGBEncoding;
            finalTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            finalTex.wrapS = finalTex.wrapT = THREE.RepeatWrapping;
            finalTex.repeat.set(1,1);

            // Bake a normal map from the blurred height map for improved lighting (linear encoding)
            try{
              const nCvs = document.createElement('canvas'); nCvs.width = w; nCvs.height = h;
              const nCtx = nCvs.getContext('2d');
              const nImg = nCtx.createImageData(w,h);
              // strength factor controls how pronounced the normals appear
              const strength = Math.max(0.8, maxDepth * 24.0);
              for(let py=0; py<h; py++){
                for(let px=0; px<w; px++){
                  const idx = py*w + px;
                  const hl = height[py*w + Math.max(0, px-1)];
                  const hr = height[py*w + Math.min(w-1, px+1)];
                  const hu = height[Math.max(0, py-1)*w + px];
                  const hd = height[Math.min(h-1, py+1)*w + px];
                  const dx = (hr - hl) * strength;
                  const dy = (hd - hu) * strength;
                  // normal in tangent-space
                  let nx = -dx, ny = -dy, nz = 1.0;
                  const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1.0;
                  nx /= len; ny /= len; nz /= len;
                  // encode to RGB [0..255]
                  const off = idx * 4;
                  nImg.data[off]   = Math.floor((nx * 0.5 + 0.5) * 255);
                  nImg.data[off+1] = Math.floor((ny * 0.5 + 0.5) * 255);
                  nImg.data[off+2] = Math.floor((nz * 0.5 + 0.5) * 255);
                  nImg.data[off+3] = 255;
                }
              }
              nCtx.putImageData(nImg, 0, 0);
              const normalTex = new THREE.CanvasTexture(nCvs);
              normalTex.encoding = THREE.LinearEncoding;
              normalTex.wrapS = normalTex.wrapT = THREE.RepeatWrapping;
              normalTex.needsUpdate = true;
              // assign both albedo and normal map to material
              mat.normalMap = normalTex;
              // user requested less aggressive normal strength
              mat.normalScale = new THREE.Vector2(0.25, 0.25);
            }catch(err){ console.warn('normal map bake failed', err); }

            return finalTex;
          }catch(err){ console.warn('applyCratersFromImage failed', err); return null; }
        };

        if(img && img.width && img.height){
          // create a darker, crater-sculpted texture and assign it
          const craterTex = applyCratersFromImage(img);
          if(craterTex){ mat.map = craterTex; }
          else { tex.encoding = THREE.sRGBEncoding; tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1,1); mat.map = tex; }
        } else {
          tex.encoding = THREE.sRGBEncoding; tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1,1); mat.map = tex;
        }
        mat.needsUpdate = true;
      }catch(e){
        console.warn('meteor texture assignment failed', e);
      }
    }, undefined, ()=>{
      // fallback to procedural texture if load fails
      const ctex = this.createProceduralMeteorTexture();
      mat.map = ctex; mat.needsUpdate = true;
    });

  // Map meteor diameter (meters) to a visual radius using a wide dynamic-range mapping
  // Endpoints: 0.1 m -> Andorra (very small), 25 m -> Montenegro (medium), 50 m -> Slovenia (large)
  const MIN_MET = 0.1, MAX_MET = 50.0;
  // Representative country areas (km^2) for visual anchors
  const AREA_ANDORRA = 468;    // Andorra ~468 km^2 (tiny)
  const AREA_MONTENEGRO = 13812; // Montenegro ~13.8k km^2 (medium)
  const AREA_SLOVENIA = 20273; // Slovenia ~20.3k km^2 (large)
  const radiusAndorra = Math.sqrt(AREA_ANDORRA / Math.PI) / 1000.0;
  const radiusMontenegro = Math.sqrt(AREA_MONTENEGRO / Math.PI) / 1000.0;
  const radiusSlovenia = Math.sqrt(AREA_SLOVENIA / Math.PI) / 1000.0;
  // normalize input size (0..1)
  const tRaw = (sizeMeters - MIN_MET) / (MAX_MET - MIN_MET);
  const t = Math.max(0, Math.min(1, tRaw));
  // bias growth so mid values map near Montenegro and larger values approach Slovenia
  const gamma = 1.6;
  const tAdj = Math.pow(t, gamma);
  // interpolate between Andorra and Slovenia (Montenegro sits mid-range)
  const visualRadiusBase = radiusAndorra + (radiusSlovenia - radiusAndorra) * tAdj;
  // optional visual amplifier, smaller now that endpoints are closer
  const VISUAL_AMPLIFIER = 1.2;
  const visualRadius = visualRadiusBase * VISUAL_AMPLIFIER;
  // clamp and set meteor scale (scene units)
  mesh.scale.setScalar(Math.max(visualRadius, 0.005));

    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  // Generate a simple procedural meteor texture as a CanvasTexture fallback
  createProceduralMeteorTexture(){
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    // base color
    ctx.fillStyle = '#9a8f85'; ctx.fillRect(0,0,size,size);
    // noisy overlay
    const image = ctx.getImageData(0,0,size,size);
    for(let y=0;y<size;y++){
      for(let x=0;x<size;x++){
        const i = (y*size + x) * 4;
        const n = Math.floor(40 * Math.random()) - 20;
        image.data[i] = Math.max(0, Math.min(255, image.data[i] + n));
        image.data[i+1] = Math.max(0, Math.min(255, image.data[i+1] + n));
        image.data[i+2] = Math.max(0, Math.min(255, image.data[i+2] + n));
        image.data[i+3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    // draw some darker circular 'craters'
    for(let i=0;i<120;i++){
      const rx = Math.random()*size, ry = Math.random()*size, r = (2 + Math.random()*18);
      const grad = ctx.createRadialGradient(rx, ry, 0, rx, ry, r);
      const alpha = 0.15 + Math.random()*0.45;
      grad.addColorStop(0, `rgba(30,20,10,${alpha})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(rx, ry, r, 0, Math.PI*2); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
    
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

  animate(time) {
    // schedule next frame and compute dt
    requestAnimationFrame(this.animate.bind(this));
    const now = time || performance.now();
    const dtMs = this._lastFrameTime ? (now - this._lastFrameTime) : 16;
    const dt = (dtMs / 1000) * this.simSpeed; // seconds scaled by simSpeed
    this._lastFrameTime = now;
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
      // apply angular velocity (tumble) if present
      if(meteor.angularVelocity && meteor.mesh){
        // convert angular velocity vector (radians/sec) into a small rotation quaternion
        const av = meteor.angularVelocity.clone().multiplyScalar(dt);
        const ax = av.length();
        if(ax > 0){
          const q = new THREE.Quaternion();
          q.setFromAxisAngle(av.normalize(), ax);
          meteor.mesh.quaternion.premultiply(q);
          // slight damping so the tumble slows over time
          meteor.angularVelocity.multiplyScalar(0.998);
        }
      }
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
      // fade out meteors that miss or have lived past their TTL (TTL in seconds)
      meteor.ttl = meteor.ttl === undefined ? 8.0 : meteor.ttl - dt;
      if(meteor.ttl <= 0){ meteor.fading = true; }
      if(meteor.fading){
        meteor.mesh.material.opacity = Math.max(0, (meteor.mesh.material.opacity||1) - 0.5 * dt);
        if(meteor.mesh.material.opacity <= 0){ meteor.active = false; if(meteor.mesh.parent) meteor.mesh.parent.remove(meteor.mesh); if(meteor.label && meteor.label.element) meteor.label.element.remove(); }
      }

      if(r < this.earthRadius + 0.2){
        meteor.active = false;
        this.createImpact(pos.clone(), meteor.size);
        this.scene.remove(meteor.mesh);
        if(meteor.label && meteor.label.element && meteor.label.element.parentNode) meteor.label.element.parentNode.removeChild(meteor.label.element);
        const li = this.labels.indexOf(meteor.label); if(li!==-1) this.labels.splice(li,1);
        this.impactCount++; const ic = document.getElementById('impactCount'); if(ic) ic.innerText = String(this.impactCount);
      
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

    // impact effects: reconstruct vertices so the ring stays flush with the globe and expands along the surface
    this.impactEffects.forEach(effect=>{
  // increase the in-plane scale factor stored per-effect (time-based)
  const growRate = effect.growRate || 0.25; // units per second
  effect.scale = (effect.scale || 1) + growRate * dt;

      // rebuild geometry positions from baseOffsets -> apply spin -> rotate into world tangent -> translate to center -> project to sphere
      const geom = effect.mesh.geometry;
      const posAttr = geom.attributes.position;
      // update spin angle (used to rotate points around the ring center)
      effect.spinAngle = (effect.spinAngle || 0) + (effect.spin * this.simSpeed);
      const sa = effect.spinAngle;
      // compute radius growth from basePositions (they include inner/outer ring coords)
      for(let i=0;i<posAttr.count;i++){
        const base = effect.basePositions[i];
        // base is (x,y,z) in ring-local plane where length(base) is the ring radius at that vertex
        const baseRadius = Math.sqrt(base.x*base.x + base.y*base.y);
        const theta = Math.atan2(base.y, base.x) + sa;
        // scaled radius
        const r = baseRadius * effect.scale;
        // world offset = u * (r*cos) + v * (r*sin)
        const worldOffset = new THREE.Vector3();
        worldOffset.addScaledVector(effect.u, Math.cos(theta) * r);
        worldOffset.addScaledVector(effect.v, Math.sin(theta) * r);
        // compute a shallow dome lift so ring forms a slightly curved dome above the surface
        const maxR = effect.maxBaseRadius * effect.scale;
        const frac = maxR > 0 ? (r / maxR) : 0;
        // exponent controls steepness; >1 makes dome flatter at edges
        const p = 1.8;
        const domeFactor = Math.max(0, 1 - Math.pow(frac, p));
        const lift = (effect.domeHeight || 0.02) * domeFactor;

        // position before projection: center + in-plane offset + small lift along normal
        const worldPos = effect.center.clone().add(worldOffset).add(effect.axis.clone().multiplyScalar(lift));
        // place vertex at exact sphere radius + lift so it's flush/perched correctly
        worldPos.setLength(this.earthRadius + lift);
        posAttr.setXYZ(i, worldPos.x, worldPos.y, worldPos.z);
      }
      posAttr.needsUpdate = true;
      geom.computeBoundingSphere();

      // time-based life for synchronized fade (default 2s)
      effect.age = (effect.age || 0) + dt;
      const totalLife = effect.totalLife || 2.0;
      const remaining = Math.max(0, totalLife - effect.age);
      const norm = remaining / totalLife;
      // set ring opacity according to remaining life
      if(effect.mesh && effect.mesh.material) effect.mesh.material.opacity = norm;

      // mushroom: slow rise (along normal) and synchronized fade with the ring
      if(effect.mushroomGroup){
        // slow scale-in to reduce pop
        const slerp = 1 - Math.pow(Math.max(0, effect.age / totalLife), 0.5);
        const scaleFactor = 0.6 + slerp * 0.4; // from initial 0.6 to ~1.0
        effect.mushroomGroup.scale.setScalar(scaleFactor);

        // compute rise: move the mushroom group a small amount along the impact normal each frame
        const riseSpeed = effect.mushroomRiseSpeed || 0.002;
        const liftSoFar = effect._mushroomLiftSoFar || 0;
        const deltaLift = riseSpeed * dt;
        const newLift = Math.min((effect.mushroomMaxLift || 0.1), liftSoFar + deltaLift);
        // apply incremental translation along axis from the original surface position
        const liftDeltaApplied = newLift - liftSoFar;
        if(liftDeltaApplied !== 0){
          effect.mushroomGroup.position.add(effect.axis.clone().multiplyScalar(liftDeltaApplied));
          effect._mushroomLiftSoFar = newLift;
        }

        // fade materials using stored base opacity so fade is deterministic and synchronized
        effect.mushroomGroup.traverse(obj=>{
          if(obj.material){
            const base = obj.userData && obj.userData._baseOpacity ? obj.userData._baseOpacity : 1.0;
            obj.material.opacity = Math.max(0, base * norm);
            obj.material.needsUpdate = true;
          }
        });

        // ensure mushrooms are removed when life ends
        if(effect.age >= totalLife){ if(effect.mushroomGroup.parent) effect.mushroomGroup.parent.remove(effect.mushroomGroup); effect.mushroomGroup = null; }
      }

      // (spin is applied by rotating base positions; don't rotate the mesh itself)

      if(effect.mesh.material.opacity <= 0){ if(effect.mesh.parent) effect.mesh.parent.remove(effect.mesh); }
    });
  // keep effects which still have visible ring or still have a mushroom group
  this.impactEffects = this.impactEffects.filter(e => (e.mesh && e.mesh.material && e.mesh.material.opacity > 0) || (e.mushroomGroup));
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

  // solar system update (if present)
  this.updateSolarSystem();

  // update ultra explosion systems
  this.updateExplosionSystems();

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

  createImpact(position, size = 1){
    // make a larger, size-dependent impact ring + mushroom
    const normal = position.clone().normalize();

  // Map meteor diameter (meters) to a visual size in scene units.
  // Invert and compress the mapping so small meteors appear relatively larger and big meteors are less gigantic.
  // This produces the behavior you requested: small meteors' rings/mushrooms are more visible, large meteors are visually tempered.
  const sizeMeters = Math.max(0.01, size || 1);
  // Map meteor diameter (meters) -> visual impact radius (scene units) using
  // a smooth, non-linear interpolation so:
  //  - very small meteors (~0.1 m) -> small impact (approx area of Ireland)
  //  - medium meteors (~22-30 m) -> medium impact (approx area of Poland)
  //  - very large meteors (~50 m) -> large impact (approx area of Algeria)
  // We convert representative country areas -> equivalent circular radii (km) then to scene units
  // (1 scene unit == 1000 km because SCENE_SCALE = 1e6 m / scene unit).
  const MIN_MET = 0.1; // meters slider min
  const MAX_MET = 50.0; // meters slider max
  // Representative country areas (km^2) for visual anchors: Montenegro (small), Hungary (medium), Poland (large)
  const AREA_MONTENEGRO = 13812; // km^2 (Montenegro)
  const AREA_HUNGARY = 93030; // km^2 (Hungary)
  const AREA_POLAND = 312679; // km^2 (Poland)
  const radiusMontenegro = Math.sqrt(AREA_MONTENEGRO / Math.PI) / 1000.0;
  const radiusHungary = Math.sqrt(AREA_HUNGARY / Math.PI) / 1000.0;
  const radiusPoland = Math.sqrt(AREA_POLAND / Math.PI) / 1000.0;

  // normalize input size (0..1)
  const tRaw = (sizeMeters - MIN_MET) / (MAX_MET - MIN_MET);
  const t = Math.max(0, Math.min(1, tRaw));
  // bias so mid values map near Hungary
  const gamma = 1.8;
  const tAdj = Math.pow(t, gamma);
  // interpolate between Montenegro and Poland radii (Hungary sits mid-range)
  const visualBase = radiusMontenegro + (radiusPoland - radiusMontenegro) * tAdj;

    // Create ring geometry sized relative to visualBase (larger inner/outer multipliers so rings read bigger)
  const ringInner = visualBase * 0.35;
  const ringOuter = visualBase * 1.05;
    const ringSegs = Math.max(32, Math.floor(16 + visualBase * 64));
    const geo = new THREE.RingGeometry(ringInner, ringOuter, ringSegs);
    const mat = new THREE.MeshBasicMaterial({ color:0xff4400, side:THREE.DoubleSide, transparent:true, opacity:0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: 1 });
    const ring = new THREE.Mesh(geo, mat);

    // orient ring so its plane is tangent to the sphere at the impact point
    const up = new THREE.Vector3(0,1,0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, normal);
    ring.quaternion.copy(quat);
    ring.position.copy(normal.clone().multiplyScalar(this.earthRadius));

    // prepare base positions from geometry in ring-local plane coordinates and apply a random in-plane rotation
    const basePositions = [];
    const posAttr = geo.attributes.position;
    const inPlaneAngle = Math.random() * Math.PI * 2;
    const rotLocal = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), inPlaneAngle);
    for(let i=0;i<posAttr.count;i++){
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      const vz = posAttr.getZ(i);
      const v = new THREE.Vector3(vx, vy, vz);
      v.applyQuaternion(rotLocal);
      basePositions.push(v);
    }

    // Make mesh have identity transform so we can write world-space positions directly into its geometry
    ring.position.set(0,0,0);
    ring.quaternion.identity();
    this.scene.add(ring);

    // compute orthonormal tangent basis (u,v) on the surface at the impact point
    let u = new THREE.Vector3();
    if (Math.abs(normal.x) < 0.9) u.set(1,0,0).cross(normal).normalize(); else u.set(0,1,0).cross(normal).normalize();
    const v = normal.clone().cross(u).normalize();

    // compute maximum base radius so we can scale dome height relative to ring size
    let maxBaseRadius = 0;
    for (let i=0;i<basePositions.length;i++){ const b = basePositions[i]; const br = Math.sqrt(b.x*b.x + b.y*b.y); if(br>maxBaseRadius) maxBaseRadius = br; }

    // effect state for ring
    const effect = {
      mesh: ring,
      axis: normal.clone(),
      spin: (0.02 + Math.random() * 0.06) * (Math.random() < 0.5 ? 1 : -1),
      center: position.clone(),
      u: u,
      v: v,
      basePositions: basePositions,
      scale: 1,
      maxBaseRadius: maxBaseRadius,
      domeHeight: Math.max(0.02, Math.min(2.0, maxBaseRadius * 0.75))
    };

    // --- mushroom cloud: build a higher-res, fluffy cap using multiple overlapping spheres (fluffs)
    try{
      const cloudBase = visualBase; // base radius for the cap
      const mushroom = new THREE.Group();

      // stem (short and stubby relative to cloudBase)
      const stemRadius = cloudBase * 0.22;
      const stemHeight = cloudBase * 0.9;
      const stemGeo = new THREE.CylinderGeometry(Math.max(0.001, stemRadius*0.5), stemRadius, Math.max(0.01, stemHeight), 16, 1);
      const stemMat = new THREE.MeshStandardMaterial({ color:0x333022, roughness:0.95, metalness:0.0, transparent:true, opacity:0.9, depthWrite:false });
      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.position.set(0, stemHeight*0.5, 0);
      mushroom.add(stem);

  // central cap: overlapping spheres to simulate fluff + a blended core for cohesion
  const capMat = new THREE.MeshStandardMaterial({ color:0xCCAA88, roughness:0.92, metalness:0.0, transparent:true, opacity:0.96, depthWrite:false });
  // blended core (slightly flattened, higher-res) to make silhouette cohesive
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), capMat.clone());
  core.scale.set(cloudBase*1.05, cloudBase*0.65, cloudBase*1.05);
  core.position.set(0, stemHeight*0.9 + cloudBase*0.05, 0);
  mushroom.add(core);

  const capMain = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), capMat.clone());
  capMain.scale.set(cloudBase*0.9, cloudBase*0.55, cloudBase*0.9);
  capMain.position.set(0, stemHeight*0.9 + cloudBase*0.05, 0);
  mushroom.add(capMain);

      // side fluffs
      // place fluffs tightly around the core with smaller sizes so they don't protrude too much
      const fluffCount = Math.max(4, Math.floor(4 + cloudBase * 2));
      for(let i=0;i<fluffCount;i++){
        const a = (i / fluffCount) * Math.PI * 2 + (Math.random()*0.12-0.06);
        const r = cloudBase * (0.18 + Math.random()*0.18); // tighter radial offsets
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y = stemHeight*0.9 + cloudBase*0.05 + (Math.random()*0.08-0.03);
        const s = cloudBase * (0.22 + Math.random()*0.25); // smaller fluffs
        const fluff = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), capMat.clone());
        fluff.scale.set(s, s*0.65, s);
        fluff.position.set(x, y, z);
        fluff.rotation.set(Math.random()*0.15, Math.random()*Math.PI, Math.random()*0.15);
        mushroom.add(fluff);
      }

      // a few smaller top fluffs for a rounded crown
      for(let j=0;j<3;j++){
        const s = cloudBase * (0.20 + Math.random()*0.22);
        const fluff = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), capMat.clone());
        fluff.scale.set(s, s*0.55, s);
        fluff.position.set((Math.random()-0.5)*cloudBase*0.12, stemHeight*0.9 + cloudBase*0.16 + Math.random()*cloudBase*0.04, (Math.random()-0.5)*cloudBase*0.12);
        mushroom.add(fluff);
      }

      // place mushroom on the surface and orient along normal
      const surfacePos = position.clone().setLength(this.earthRadius + 0.001);
      mushroom.position.copy(surfacePos);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), normal.clone());
      mushroom.quaternion.copy(q);
  mushroom.scale.setScalar(0.85);
      this.scene.add(mushroom);

      // Ensure each mushroom material stores a base opacity so we can set a deterministic fade
      mushroom.traverse(obj=>{
        if(obj.material){
          // make transparent if not already
          obj.material.transparent = true;
          // store original opacity on userData so we can fade to norm * base
          obj.userData = obj.userData || {};
          obj.userData._baseOpacity = (typeof obj.material.opacity === 'number') ? obj.material.opacity : 1.0;
        }
      });

      // store animation params
      effect.mushroomGroup = mushroom;
      // make mushroom slow and longer lived; store a rise speed and a maximum lift above the surface
      effect.mushroomLife = 4.0 + Math.min(10.0, visualBase * 6.0); // larger clouds live longer
      // rise speed (scene units per second) - small and proportional to visualBase, tuned for subtlety
      effect.mushroomRiseSpeed = Math.max(0.00005, visualBase * 0.02);
      // maximum lift above the sphere surface (scene units) so mushroom never 'launches' to space
      effect.mushroomMaxLift = Math.max(0.01, visualBase * 0.45);
      effect.mushroomBaseScale = cloudBase;
    }catch(e){ console.warn('mushroom creation failed', e); }

    this.impactEffects.push(effect);
  createImpact(position, meteor){
    // Compute impact summary (approximate/visualization-oriented)
    const summary = this.computeImpactSummary(position, meteor);

    // determine lat/lon and region name for Earth impacts (if relevant)
    const regionName = (position && position.length && this._regionNameFromPosition(position)) || 'Unknown';

    // Update UI summary area (append)
    try{
      const panel = document.getElementById('impactPanelContent');
      if(panel){
        const item = document.createElement('div');
        item.style.marginBottom = '8px'; item.style.padding = '8px'; item.style.borderBottom = '1px solid rgba(0,0,0,0.08)';
        item.innerHTML = `<b>${new Date().toLocaleTimeString()}</b><br>Energy: ${summary.TNT_tons.toFixed(2)} tons TNT<br>Crater: ${(summary.craterDiameter_m/1000).toFixed(2)} km<br>Region: ${regionName}`;
        panel.insertBefore(item, panel.firstChild);
      }
    }catch(e){ console.warn('Failed to update impact UI', e); }

    // Also show in the top-right impact panel
    try{
      // old panel duplicate removed - we now use the top-right impact window
    }catch(e){ /* ignore panel errors */ }

  const normal = position.clone().normalize();
  // determine rough surface type at impact point (land vs ocean) using a deterministic spherical pattern
  const surfaceIsOcean = this.isOceanAt(position);

    // Flash: brief point light at impact
    const flash = new THREE.PointLight(0xffeecc, 4.0, 60);
    flash.position.copy(normal.clone().multiplyScalar(this.earthRadius + 0.2));
    this.scene.add(flash);

    // Shock ring: a thin disk that expands and fades
    const shockGeo = new THREE.RingGeometry(0.01, 0.02, 64);
    const shockMat = new THREE.MeshBasicMaterial({ color:0xffccaa, side:THREE.DoubleSide, transparent:true, opacity:0.9 });
    const shock = new THREE.Mesh(shockGeo, shockMat);
    const shockQuat = new THREE.Quaternion();
    shockQuat.setFromUnitVectors(new THREE.Vector3(0,1,0), normal);
    shock.quaternion.copy(shockQuat);
    shock.position.copy(normal.multiplyScalar(this.earthRadius+0.01));
    this.scene.add(shock);

    // Dust cloud: a transparent sphere that grows and fades
  const dustGeo = new THREE.SphereGeometry(0.05, 12, 12);
  const dustMat = new THREE.MeshStandardMaterial({ color: surfaceIsOcean?0x335577:0x553322, transparent:true, opacity:0.85, roughness:1.0, metalness:0 });
    const dust = new THREE.Mesh(dustGeo, dustMat);
    dust.position.copy(normal.clone().multiplyScalar(this.earthRadius+0.02));
    this.scene.add(dust);

    // Damage rings on the surface (severe/medium damage)
    const damageRings = [];
    const addDamageRing = (radius_km, color, opacity)=>{
      if(this.showDamageOverlay === false) return; // respect overlay toggle
      const rScene = (radius_km*1000)/this.SCENE_SCALE;
      const rg = new THREE.RingGeometry(rScene*0.98, rScene*1.02, 128);
      const rm = new THREE.MeshBasicMaterial({ color, side:THREE.DoubleSide, transparent:true, opacity });
      const ring = new THREE.Mesh(rg, rm);
      ring.rotation.copy(shock.rotation);
      ring.position.copy(normal.clone().multiplyScalar(this.earthRadius+0.015));
      this.scene.add(ring);
      damageRings.push(ring);
    };
    addDamageRing(summary.severeRadius_km, 0xff4444, 0.25);
    addDamageRing(summary.glassRadius_km, 0xffaa66, 0.18);

    // push to impactEffects for animation/cleanup
    const impactEffect = {
      mesh: shock,
      type: 'shock',
      lifetime: 0,
      maxLifetime: 4.0,
      flash,
      dust,
      damageRings
    };
    this.impactEffects.push(impactEffect);

    // Ultra realistic explosions (particle/debris) if enabled
    if(this.ultraExplosions){
      this.spawnUltraExplosion(shock.position.clone(), summary);
    }

    // Aerodynamic markup if enabled
    if(this.showAero && meteor){
      try{
        // small heat glow at impact point
        const glow = new THREE.PointLight(0xffaa66, 2.5, 30);
        glow.position.copy(shock.position);
        this.scene.add(glow);
        impactEffect.aeroGlow = glow;
      }catch(e){}
    }

    // If surface is land, spawn a mushroom cloud effect; if ocean, spawn a water plume
    if(surfaceIsOcean){
      // ocean plume: taller, bluish, more spray
      const plume = new THREE.Group();
      plume.position.copy(normal.clone().multiplyScalar(this.earthRadius+0.02));
      const plumeGeo = new THREE.ConeGeometry(0.02, 0.2, 16);
      const plumeMat = new THREE.MeshStandardMaterial({ color:0x88aacc, transparent:true, opacity:0.9, roughness:1 });
      const cone = new THREE.Mesh(plumeGeo, plumeMat);
      cone.rotation.x = Math.PI/2;
      plume.add(cone);
      this.scene.add(plume);
      impactEffect.oceanPlume = { group:plume, riseSpeed: 0.02 + (summary.size_m||1)/2000, life:0, maxLife:6 + (summary.size_m||1)/20 };
    } else {
      // mushroom cloud: stem + cap
      const mush = new THREE.Group();
      mush.position.copy(normal.clone().multiplyScalar(this.earthRadius+0.02));
      // stem (cylinder)
      const stemGeo = new THREE.CylinderGeometry(0.01, 0.02, 0.2, 12);
      const stemMat = new THREE.MeshStandardMaterial({ color:0x332211, transparent:true, opacity:0.95 });
      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.position.y = 0.1;
      mush.add(stem);
      // cap (sphere that will expand)
      const capGeo = new THREE.SphereGeometry(0.08, 16, 12);
      const capMat = new THREE.MeshStandardMaterial({ color:0xffaa66, transparent:true, opacity:0.95, roughness:1 });
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.y = 0.22;
      mush.add(cap);
      // add some sprite clouds to cap if explosion texture exists
      if(explosionTexture){
        const s = new THREE.SpriteMaterial({ map: explosionTexture, color:0xffffff, transparent:true, opacity:0.95, depthWrite:false });
        const sp = new THREE.Sprite(s); sp.scale.set(0.5,0.5,1); sp.position.set(0,0.22,0); mush.add(sp);
      }
      this.scene.add(mush);
      impactEffect.mushroom = { group:mush, stem, cap, riseSpeed: 0.02 + (summary.size_m||1)/1000, life:0, maxLife:10 + (summary.size_m||1)/10 };
    }

    // camera shake scaling: stronger for bigger meteors / higher KE
    try{
      const ke = summary.KE || 0;
      const sizeFactor = Math.max(1, (summary.size_m||1)/10);
      // base amplitude from KE (log scale) and sizeFactor
      const base = Math.max(0.02, (Math.log10(Math.max(ke,1)) - 5) * 0.06);
      const amp = Math.min(4.0, base * Math.sqrt(sizeFactor));
      this.cameraShake.amplitude = Math.max(this.cameraShake.amplitude || 0, amp);
      this.cameraShake.time = 0;
    }catch(e){ /* ignore */ }
  }

  // Spawn a richer explosion: particles, debris shards, heat glow, and a long-lasting ember field
  spawnUltraExplosion(position, summary){
    if(!this.explosions) this.initExplosionSystem();
    const group = new THREE.Group();
    group.position.copy(position);
    // light/heat core
    const coreLight = new THREE.PointLight(0xffcc88, 6.0, 120, 2);
    group.add(coreLight);
    // Billboarded explosion sprite clouds (volumetric look)
    if(explosionTexture){
      // scale sprite count and size by impactor size
      const sizeScale = Math.max(1, (summary.size_m || 1) / 50);
      const spriteCount = Math.min(24, Math.floor(6 * sizeScale) + Math.floor(Math.random()*6));
      for(let i=0;i<spriteCount;i++){
        const mat = new THREE.SpriteMaterial({ map: explosionTexture, color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        const scale = (1.2 + Math.random()*2.5) * Math.sqrt(sizeScale);
        sprite.scale.set(scale, scale, 1);
        sprite.position.set((Math.random()-0.5)*0.7*sizeScale, (Math.random()-0.2)*0.7*sizeScale, (Math.random()-0.5)*0.7*sizeScale);
        sprite.material.rotation = Math.random()*Math.PI*2;
        group.add(sprite);
      }
      // increase core light for bigger impacts
      coreLight.intensity = Math.min(40, 6.0 * sizeScale);
      coreLight.distance = 120 * Math.sqrt(sizeScale);
    }

    // particle geometry - use Points for many small embers
  const sizeScale = Math.max(1, (summary.size_m || 1) / 50);
  const particleCount = Math.min(5000, Math.floor((400 + Math.min(2000, Math.floor(summary.TNT_tons || 0))) * Math.sqrt(sizeScale)));
    const positions = new Float32Array(particleCount * 3);
    const velocities = [];
    for(let i=0;i<particleCount;i++){
      positions[i*3+0] = 0; positions[i*3+1] = 0; positions[i*3+2] = 0;
      // random velocity biased outward
      const dir = new THREE.Vector3((Math.random()*2-1),(Math.random()*1.2),(Math.random()*2-1)).normalize();
      const speed = 5 + Math.random()*30;
      velocities.push(dir.multiplyScalar(speed));
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pMat = new THREE.PointsMaterial({ size: 0.02, color: 0xffbb66, transparent:true, opacity:0.95, depthWrite:false });
    const points = new THREE.Points(pGeo, pMat);
    group.add(points);

    // debris shards (meshes) - a handful
    const debris = [];
  const debrisCount = Math.min(200, Math.floor(10 + Math.log10(Math.max(summary.KE,1)) * sizeScale));
    for(let i=0;i<debrisCount;i++){
      const dg = new THREE.BoxGeometry(0.02, 0.02, 0.06);
      const dm = new THREE.MeshStandardMaterial({ color: 0x553322, roughness:1.0, metalness:0 });
      const mesh = new THREE.Mesh(dg, dm);
      mesh.position.set(0,0,0);
      mesh.userData.velocity = new THREE.Vector3((Math.random()*2-1),(Math.random()*1.2),(Math.random()*2-1)).normalize().multiplyScalar(2 + Math.random()*15);
      mesh.userData.angular = new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(5);
      group.add(mesh); debris.push(mesh);
    }

    // ember field particle metadata
    const explosion = { group, points, pGeo, velocities, pointsMat: pMat, debris, coreLight, life:0, maxLife:8 + Math.random()*6 };
    this.explosions.push(explosion);
    // scale entire explosion group by size factor for more dramatic visuals
    const overallScale = Math.max(1, (summary.size_m || 1) / 50);
    group.scale.setScalar(Math.sqrt(overallScale));
    this.scene.add(group);
  }

  // update explosion particle systems each frame
  updateExplosionSystems(){
    if(!this.explosions) return;
    const dt = 0.016 * this.simSpeed;
    for(let i=this.explosions.length-1;i>=0;i--){
      const ex = this.explosions[i];
      ex.life += dt;
      const positions = ex.pGeo.attributes.position.array;
      for(let j=0;j<ex.velocities.length;j++){
        const v = ex.velocities[j];
        positions[j*3+0] += v.x * dt;
        positions[j*3+1] += v.y * dt;
        positions[j*3+2] += v.z * dt;
        // simple air drag
        v.multiplyScalar(0.995 - dt*0.05);
        // gravity pull back toward surface (small)
        v.y -= 9.8 * 0.02 * dt;
      }
      ex.pGeo.attributes.position.needsUpdate = true;
      // debris physics
      ex.debris.forEach(d=>{
        d.position.addScaledVector(d.userData.velocity, dt);
        d.rotation.x += d.userData.angular.x * dt;
        d.rotation.y += d.userData.angular.y * dt;
        d.rotation.z += d.userData.angular.z * dt;
        d.userData.velocity.multiplyScalar(0.995 - dt*0.05);
        d.userData.velocity.y -= 9.8 * 0.02 * dt;
      });
      // fade core light and particles over time
      const fade = Math.max(0, 1 - ex.life / ex.maxLife);
      ex.coreLight.intensity = 6.0 * fade;
      ex.points.material.opacity = 0.9 * fade;
      // cleanup
      if(ex.life > ex.maxLife){
        if(ex.group.parent) this.scene.remove(ex.group);
        ex.pGeo.dispose();
        ex.points.material.dispose();
        ex.debris.forEach(d=>{ if(d.geometry) d.geometry.dispose(); if(d.material) d.material.dispose(); });
        this.explosions.splice(i,1);
      }
    }
  }

  // Compute approximate impact metrics for visualization
  computeImpactSummary(position, meteor){
    // If a meteor object is provided, prefer its properties (size, mass, velocity)
    let src = null;
    if(meteor) src = meteor;
    else {
      // Try to use last-impacting meteor info if available (best-effort)
      for(let i=this.meteors.length-1;i>=0;i--){
        const m = this.meteors[i];
        if(!m.active){ continue; }
        if(m.mesh && m.mesh.position.distanceTo(position) < 1.0){ src = m; break; }
      }
    }
    // fallback: use a small meteor template
    if(!src){
      src = { size: 50, mass: 1e8, physVelocity: new THREE.Vector3(0,0,20000) };
    }

    const size_m = src.size || 50; // diameter in meters
    const density = src.density || 3000; // kg/m3
    const radius_m = size_m/2;
    const volume = (4/3)*Math.PI*radius_m*radius_m*radius_m;
    const mass = src.mass || (density * volume);
    const v = (src.physVelocity && src.physVelocity.length) ? src.physVelocity.length() : (src.velocity? src.velocity*this.SCENE_SCALE : 20000);
    const KE = 0.5 * mass * v * v; // J

    // TNT conversion (tons of TNT) and Hiroshima eq (~15 kilotons = 15000 tons)
    const TNT_tons = KE / 4.184e9;
    const Hiroshima_eq = TNT_tons / 15000;

    // Simple atmospheric ablation model (very simplified): mass loss fraction depends on velocity and size
    const angle_deg = 45; const angleFactor = Math.sin(angle_deg * Math.PI/180);
    const ablationFactor = Math.min(0.99, Math.max(0, 0.15 * (v/11000) * (size_m/50) * angleFactor));
    const massFinal = mass * (1 - ablationFactor);
    const massFraction = massFinal / mass;

    // Crater diameter scaling (approximate, visualization-focused): empirical power-law on energy
    // D_final (m) = C * KE^(0.25) with C tuned to produce plausible sizes for common events
    const C = 0.27; // empirical tuning constant
    const craterDiameter_m = C * Math.pow(Math.max(KE,1), 0.25);
    const craterDepth_m = craterDiameter_m / 5.0;

    // Simple damage radii heuristics (km)
    const severeRadius_km = Math.min(500, Math.max(1, (craterDiameter_m/1000) * 1.5));
    const glassRadius_km = Math.min(2000, Math.max(severeRadius_km+20, severeRadius_km * 4));

    return {
      size_m, mass, massFinal, massFraction,
      KE, TNT_tons, Hiroshima_eq,
      craterDiameter_m, craterDepth_m,
      severeRadius_km, glassRadius_km
    };
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
  
  // Build the initial text editor content (curated briefings)
  _buildEditorContent(){
    return `NASA & Simulation Briefing\n\nNASA Overview:\nNASA (National Aeronautics and Space Administration) leads U.S. civil spaceflight, scientific discovery, and aeronautics research. Key programs include human spaceflight (Artemis), Earth and planetary science missions (e.g., Landsat, Hubble, Mars rovers), and technology development for future exploration.\n\nAbout Meteors & Impacts:\n- Meteoroids are small bodies (dust to meters) in space; when they enter Earth's atmosphere they become meteors (shooting stars). If fragments reach the ground, they are meteorites.\n- Impact energy is computed as KE = 1/2 m v^2. Large impacts can release energy comparable to many kilotons or megatons of TNT and create craters and atmospheric effects.\n- Our simulation approximates kinetic energy, crater size, and has visual effects (shock rings, mushroom clouds, water plumes) scaled by meteor size and velocity.\n\nPlanets in this simulation:\n- The decorative solar system shows scaled planets for context (not to scale with real orbital parameters).\n- Earth is the primary target; impacts are detected when meteors reach surface radius in scene units.\n\nNASA Space Apps Challenge:\n- The NASA International Space Apps Challenge is a global hackathon that invites participants to develop solutions to real-world problems using NASA data. Teams build projects addressing challenges in Earth observation, space exploration, and more. Learn more at: https://www.spaceappschallenge.org/\n\nFurther reading and resources:\n- NASA website: https://www.nasa.gov/\n- NEO (Near Earth Object) Program: https://cneos.jpl.nasa.gov/\n- NASA Planetary Data System and mission pages for detailed scientific data.\n\n(You can edit this text freely. It is a simple in-browser text editor; contents are not saved to disk automatically.)`;
  }

}

const app = new App();
app.init();
app.animate();

// expose for debugging
window.app = app;
