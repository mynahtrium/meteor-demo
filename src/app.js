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

    // physics
    this.G = 6.67430e-11;
    this.earthMass = 5.972e24;
    this.earthRadiusMeters = 6371000;
    this.SCENE_SCALE = 1e6; // meters per scene unit
    this.earthRadius = 6371 / 1000; // scene units
    this.gravityStrength = 0.02;
  // Visual scaling factor for meteors (multiplies the scene scale conversion so meteors are visible)
  // Increase if meteors appear too small. This does not change physics, only mesh size.
  this.meteorVisualScale = 2000;

    this.mouse = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();

    // placeholders
    this.cursor = null;
    this.predictedImpactMarker = null;
    // camera framing state for smooth on-spawn framing
    this.cameraFrame = { active: false };
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
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
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
  // play click sound on any UI button press
  document.addEventListener('click', (ev)=>{ if(ev.target && ev.target.tagName === 'BUTTON') this.playClick(); });
    if (el('simSpeed')) el('simSpeed').oninput = (e) => { this.simSpeed = parseFloat(e.target.value); if (el('simSpeedVal')) el('simSpeedVal').innerText = parseFloat(e.target.value).toFixed(2); };
    if (el('speed')) { const s = el('speed'); if (el('speedVal')) el('speedVal').innerText = s.value; s.oninput = (e) => { if (el('speedVal')) el('speedVal').innerText = parseFloat(e.target.value).toFixed(2); }; }
  // meteor size slider
  if (el('meteorSize')) { const ms = el('meteorSize'); if (el('meteorSizeVal')) el('meteorSizeVal').innerText = parseFloat(ms.value).toFixed(2); ms.oninput = (e) => { if (el('meteorSizeVal')) el('meteorSizeVal').innerText = parseFloat(e.target.value).toFixed(2); }; }
    if (el('reset')) el('reset').onclick = () => this.resetScene();
    if (el('pause')) el('pause').onclick = (e) => { this.paused = !this.paused; e.target.innerText = this.paused ? 'Resume' : 'Pause'; };
    if (el('toggleAiming')) el('toggleAiming').onclick = (e) => { this.showAiming = !this.showAiming; e.target.innerText = this.showAiming ? 'Hide Aiming' : 'Show Aiming'; const aim = this.scene.getObjectByName('aimingLine'); if (aim) aim.visible = this.showAiming; };
    if (el('fire')) el('fire').onclick = () => this.shootMeteor();
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
  const solarBtn = el('toggleSolar'); if(solarBtn) solarBtn.onclick = (e)=>{ this.toggleSolarSystem(e); };
  const dmgBtn = el('toggleDamageOverlay'); if(dmgBtn) dmgBtn.onclick = (e)=>{ this.showDamageOverlay = !this.showDamageOverlay; e.target.innerText = this.showDamageOverlay? 'Hide Damage Overlay' : 'Show Damage Overlay'; };
  const ultraBtn = el('toggleUltraExplosions'); if(ultraBtn) ultraBtn.onclick = (e)=>{ this.ultraExplosions = !this.ultraExplosions; e.target.innerText = this.ultraExplosions? 'Disable Ultra Realistic Explosions' : 'Enable Ultra Realistic Explosions'; };
  const startBtn = el('start-button'); if(startBtn) startBtn.onclick = ()=>{ this.playClick(); };
    const impactClose = document.getElementById('impact-close'); if(impactClose) impactClose.onclick = ()=>{ const w=document.getElementById('impact-window'); if(w) w.classList.add('hidden'); };

    // Editor/taskbar wiring
    const openEditorBtn = el('open-editor');
    const editorWin = document.getElementById('text-editor');
    const editorClose = document.getElementById('editor-close');
    const editorMin = document.getElementById('editor-min');
    const editorContent = document.getElementById('editor-content');
    if(openEditorBtn && editorWin){
      openEditorBtn.onclick = (e)=>{
        editorWin.classList.remove('hidden');
        // populate content with curated info
        if(editorContent && editorContent.value.trim().length===0){
          editorContent.value = this._buildEditorContent();
        }
      };
    }
    if(editorClose && editorWin) editorClose.onclick = ()=> editorWin.classList.add('hidden');
    if(editorMin && editorWin) editorMin.onclick = ()=> editorWin.classList.toggle('hidden');

    // Options app wiring
    const openOptions = el('open-options');
    const optionsApp = document.getElementById('options-app');
    const optionsClose = document.getElementById('options-close');
    if(openOptions && optionsApp){ openOptions.onclick = ()=> optionsApp.classList.remove('hidden'); }
    if(optionsClose && optionsApp) optionsClose.onclick = ()=> optionsApp.classList.add('hidden');

    // option inputs
    const optSun = document.getElementById('opt-sun'); const optMoon = document.getElementById('opt-moon');
    const optTrails = document.getElementById('opt-trails'); const optReal = document.getElementById('opt-realistic');
    const optMoonCraters = document.getElementById('opt-moon-craters'); const optKeySize = document.getElementById('opt-key-size');
    const optSizeRange = document.getElementById('opt-meteor-size-range');
    if(optSun) optSun.onchange = (e)=>{ if(e.target.checked) this.createMoonAndSun(); else { if(this.sun && this.sun.parent) this.scene.remove(this.sun); if(this.sunLight && this.sunLight.parent) this.scene.remove(this.sunLight); this.sun=null; this.sunLight=null; } };
    if(optMoon) optMoon.onchange = (e)=>{ if(e.target.checked) this.createMoonAndSun(); else { if(this.moon && this.moon.parent) this.scene.remove(this.moon); this.moon=null; } };
    if(optTrails) optTrails.onchange = (e)=>{ this.trailsEnabled = !!e.target.checked; };
    if(optReal) optReal.onchange = (e)=>{ this.realistic = !!e.target.checked; };
    if(optMoonCraters) optMoonCraters.onchange = (e)=>{ this.moonCraters = !!e.target.checked; if(this.moonCraters) this._ensureMoonCraters(); };
    if(optSizeRange) optSizeRange.oninput = (e)=>{ const v=parseFloat(e.target.value); const ms = document.getElementById('meteorSize'); if(ms) ms.value = v; };

    // keyboard control for meteor size (+/-)
    window.addEventListener('keydown', (ev)=>{
      try{
        if(optKeySize && optKeySize.checked){
          const ms = document.getElementById('meteorSize'); if(!ms) return;
          let val = parseFloat(ms.value || 1);
          if(ev.key === '+' || ev.key === '=') val = Math.min(200, val * 1.1);
          if(ev.key === '-' || ev.key === '_') val = Math.max(0.1, val / 1.1);
          ms.value = val; const vdisp = document.getElementById('meteorSizeVal'); if(vdisp) vdisp.innerText = parseFloat(val).toFixed(2);
        }
      }catch(e){}
    });

    // simple drag for window by titlebar
    try{
      const titlebar = editorWin && editorWin.querySelector('.titlebar');
      if(titlebar){
        let dragging=false, sx=0, sy=0, ox=0, oy=0;
        titlebar.addEventListener('mousedown', (ev)=>{ dragging=true; sx=ev.clientX; sy=ev.clientY; const r = editorWin.getBoundingClientRect(); ox=r.left; oy=r.top; document.body.style.userSelect='none'; });
        window.addEventListener('mousemove', (ev)=>{ if(!dragging) return; const dx = ev.clientX - sx; const dy = ev.clientY - sy; editorWin.style.left = (ox + dx) + 'px'; editorWin.style.top = (oy + dy) + 'px'; });
        window.addEventListener('mouseup', ()=>{ dragging=false; document.body.style.userSelect='auto'; });
      }
    }catch(e){ console.warn('Editor drag init failed', e); }

    // initial aiming visibility
    const aimObj = this.scene.getObjectByName('aimingLine'); if (aimObj) aimObj.visible = this.showAiming;

    // attempt to auto-load a local earth texture file if present (project root: earth_texture.jpg)
    try { this.tryLoadLocalEarthTexture(); } catch(e){ /* ignore */ }
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

  onKeyDown(event) { if(event.code === 'Space') this.shootMeteor(); }

  shootMeteor() {
    const speedEl = document.getElementById('speed');
    const speed = speedEl ? parseFloat(speedEl.value) : 0.05;
    const sizeEl = document.getElementById('meteorSize');
    let size = sizeEl ? parseFloat(sizeEl.value) : 0.5;
    if(this.moreBigMeteors){ size = 3 + Math.random() * 37; }
    const meteorGeo = new THREE.SphereGeometry(1, 16, 16);
  const meteorMat = new THREE.MeshStandardMaterial({ color:0x888888, metalness:0.2, roughness:0.5 });
  if(meteorTexture){ meteorMat.map = meteorTexture; meteorMat.needsUpdate = true; }
    const meteor = new THREE.Mesh(meteorGeo, meteorMat);
    meteor.position.copy(this.camera.position);
    const dir = new THREE.Vector3().subVectors(this.cursor.position, this.camera.position).normalize();
  const density = 3000;
  const volume = (4/3)*Math.PI*Math.pow(size/2,3);
  const mass = density * volume;
  const area = Math.PI * Math.pow(size/2,2);
    this.scene.add(meteor);
    const label = this.createLabel(`Meteor (${(size).toFixed(2)} m)`, meteor.position);
    // create a dynamic trail (line) for this meteor
    try{
      const maxTrail = 40;
      const trailPos = new Float32Array(maxTrail * 3);
      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
      trailGeo.setDrawRange(0, 0);
      const trailMat = new THREE.LineBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0.9 });
      const trailLine = new THREE.Line(trailGeo, trailMat);
      trailLine.frustumCulled = false;
      this.scene.add(trailLine);
      var trailObj = { line: trailLine, geo: trailGeo, positions: trailPos, max: maxTrail, count: 0 };
    }catch(e){ var trailObj = null; }
    const physVelocity = dir.clone().multiplyScalar(speed * this.SCENE_SCALE);
    // Convert meters -> scene units. Geometry radius is 1 (1 meter), so to represent
    // a meteor with diameter `size` (meters) we scale by radius = size/2 in meters.
  const meterToScene = 1 / this.SCENE_SCALE;
  const radiusScene = (size / 2) * meterToScene;
  const visScale = Math.max(radiusScene * this.meteorVisualScale, 1e-6); // avoid zero scale but make visible
  meteor.scale.setScalar(visScale);
    this.meteors.push({ mesh:meteor, velocity:dir.multiplyScalar(speed), physVelocity, active:true, label, mass, area, size, trail: trailObj });
  }

  resetScene() {
    this.meteors.forEach(m=>{ if(m.mesh) this.scene.remove(m.mesh); if(m.label && m.label.element) m.label.element.remove(); });
    this.meteors = [];
    this.impactEffects.forEach(e=>{ if(e.mesh) this.scene.remove(e.mesh); });
    this.impactEffects = [];
    this.impactCount = 0; const ic = document.getElementById('impactCount'); if(ic) ic.innerText = '0';
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    // Pulse cursor
    const ringMesh = this.cursor && this.cursor.getObjectByName && this.cursor.getObjectByName('cursorRing');
    if(ringMesh){ const pulse = 1 + 0.1 * Math.sin(Date.now() * 0.005); this.cursor.scale.set(pulse,pulse,pulse); }
    // update aiming line
    const aimingLine = this.scene.getObjectByName && this.scene.getObjectByName('aimingLine');
    if(aimingLine){ const positions = aimingLine.geometry.attributes.position.array; positions[0]=this.camera.position.x; positions[1]=this.camera.position.y; positions[2]=this.camera.position.z; positions[3]=this.cursor.position.x; positions[4]=this.cursor.position.y; positions[5]=this.cursor.position.z; aimingLine.geometry.attributes.position.needsUpdate=true; }
  // update counters
    const mc = document.getElementById('meteorCount'); if(mc) mc.innerText = String(this.meteors.length);
    // predicted impact
    this.updatePredictedImpact();
    const mouseCursor = this.scene.getObjectByName('mouseCursor'); if(mouseCursor){ mouseCursor.position.copy(this.cursor.position); }

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

    // camera shake update: apply an additive offset to camera.position based on a simple damped noise
    if(this.cameraShake && this.cameraShake.amplitude > 0.0001){
      this.cameraShake.time += 0.016 * this.simSpeed;
      const a = this.cameraShake.amplitude;
      const f = this.cameraShake.frequency;
      // simple pseudo-random shake using sines
      const ox = (Math.sin(this.cameraShake.time * f * 1.3) + Math.sin(this.cameraShake.time * f * 0.7 * 1.1)) * 0.5 * a;
      const oy = (Math.sin(this.cameraShake.time * f * 1.7) + Math.sin(this.cameraShake.time * f * 0.5 * 1.3)) * 0.5 * a;
      const oz = (Math.sin(this.cameraShake.time * f * 1.1) + Math.sin(this.cameraShake.time * f * 0.9)) * 0.5 * a;
      this.camera.position.add(new THREE.Vector3(ox, oy, oz));
      // decay amplitude
      this.cameraShake.amplitude *= Math.pow(this.cameraShake.decay, this.simSpeed);
    }

    // Meteors update (simple version: non-realistic faster path)
    this.meteors.forEach(meteor=>{
      if(!meteor.active) return;
      const pos = meteor.mesh.position;
      const r = pos.length();
      if(this.realistic){
        // keep original complex integration: for brevity we fallback to simple motion here
        const posMeters = pos.clone().multiplyScalar(this.SCENE_SCALE);
        const vel = meteor.physVelocity.clone();
        const dt = 0.02 * this.simSpeed;
        // semi-implicit Euler gravity approximation (faster)
        const rmag = posMeters.length();
        const g = posMeters.clone().multiplyScalar(-this.G*this.earthMass/(rmag*rmag*rmag));
        meteor.physVelocity.add(g.multiplyScalar(dt));
        posMeters.add(meteor.physVelocity.clone().multiplyScalar(dt));
        meteor.mesh.position.copy(posMeters.multiplyScalar(1/this.SCENE_SCALE));
        if(meteor.label) meteor.label.position.copy(meteor.mesh.position);
      } else {
        const gravityAccel = pos.clone().normalize().multiplyScalar(-this.gravityStrength/(r*r));
        meteor.velocity.add(gravityAccel.multiplyScalar(this.simSpeed));
        pos.add(meteor.velocity.clone().multiplyScalar(this.simSpeed));
      }
      // update trail: push current position into trail buffer
      if(meteor.trail){
        try{
          const t = meteor.trail;
          // shift older positions to make room (simple FIFO)
          // move values back by 3 to discard oldest
          const positions = t.positions;
          // shift array by 3 (slow but fine for small buffers)
          for(let k=(t.max-1);k>0;k--){ positions[k*3+0]=positions[(k-1)*3+0]; positions[k*3+1]=positions[(k-1)*3+1]; positions[k*3+2]=positions[(k-1)*3+2]; }
          // write current pos into index 0
          positions[0]=pos.x; positions[1]=pos.y; positions[2]=pos.z;
          // increase count up to max
          t.count = Math.min(t.max, t.count+1);
          t.geo.setDrawRange(0, t.count);
          t.geo.attributes.position.needsUpdate = true;
          // fade trail opacity slightly based on count
          if(t.line && t.line.material) t.line.material.opacity = Math.max(0.08, 0.9 * (1 - (t.count / t.max)));
        }catch(e){ /* ignore trail update errors */ }
      }
      if(r < this.earthRadius + 0.2){
        meteor.active = false;
        // create visual effects for the impact before cleaning up
        this.createImpact(pos.clone(), meteor);

        // remove meteor mesh and dispose resources
        try{
          if(meteor.mesh){
            if(meteor.mesh.parent) this.scene.remove(meteor.mesh);
            if(meteor.mesh.geometry){ meteor.mesh.geometry.dispose(); }
            if(meteor.mesh.material){ if(Array.isArray(meteor.mesh.material)){ meteor.mesh.material.forEach(m=>{ if(m.map) m.map.dispose(); m.dispose(); }); } else { if(meteor.mesh.material.map) meteor.mesh.material.map.dispose(); meteor.mesh.material.dispose(); } }
          }
        }catch(e){ console.warn('Failed to dispose meteor mesh', e); }

        // remove and dispose trail if present
        if(meteor.trail){ try{
          if(meteor.trail.line && meteor.trail.line.parent) this.scene.remove(meteor.trail.line);
          if(meteor.trail.geo) { if(meteor.trail.geo.attributes && meteor.trail.geo.attributes.position) meteor.trail.geo.attributes.position = null; meteor.trail.geo.dispose(); }
          if(meteor.trail.line && meteor.trail.line.material) meteor.trail.line.material.dispose();
        }catch(e){ console.warn('Failed to remove trail', e); } }

        // remove label DOM element and from labels array
        try{ if(meteor.label && meteor.label.element && meteor.label.element.parentNode) meteor.label.element.parentNode.removeChild(meteor.label.element); }catch(e){}
        const li = this.labels.indexOf(meteor.label); if(li!==-1) this.labels.splice(li,1);

        // null out references to allow GC
        meteor.mesh = null; meteor.trail = null; meteor.label = null;
        this.impactCount++; const ic = document.getElementById('impactCount'); if(ic) ic.innerText = String(this.impactCount);
        try{
          let speedAtImpact = meteor.physVelocity ? meteor.physVelocity.length() : (meteor.velocity ? meteor.velocity.length()*this.SCENE_SCALE : 0);
          const ke = 0.5 * (meteor.mass || 1) * speedAtImpact * speedAtImpact;
          const keTons = ke / 4.184e9;
            const ie = document.getElementById('impactEnergy'); if(ie) ie.innerText = `${ke.toExponential(3)} J (~${keTons.toFixed(2)} kt)`;
          // camera shake: map kinetic energy to amplitude (clamped)
          try{
            // scale down energy to a usable amplitude range
            const amp = Math.min(0.8, Math.max(0.02, Math.log10(Math.max(ke,1)) - 6) * 0.08);
            this.cameraShake.amplitude = Math.max(this.cameraShake.amplitude || 0, amp);
            this.cameraShake.time = 0;
          }catch(e){ /* ignore shake errors */ }
        }catch(e){ console.error('impact energy calc', e); const ie = document.getElementById('impactEnergy'); if(ie) ie.innerText = '-'; }
      }
    });

    // impact effects
    // animate impact effects (shock rings, dust, flash, damage rings)
    this.impactEffects.forEach(effect=>{
      effect.lifetime = (effect.lifetime || 0) + (0.016 * this.simSpeed);
      const tNorm = effect.lifetime / (effect.maxLifetime || 3.0);
      if(effect.type === 'shock'){
        // expand ring
        const s = 1 + tNorm * 20 * this.simSpeed;
        if(effect.mesh) effect.mesh.scale.setScalar(s);
        if(effect.mesh && effect.mesh.material) effect.mesh.material.opacity = Math.max(0, 0.9 * (1 - tNorm));
        // flash fade
        if(effect.flash) effect.flash.intensity = Math.max(0, 4.0 * (1 - tNorm));
        // dust growth and fade
        if(effect.dust){ effect.dust.scale.setScalar(1 + tNorm * 12); effect.dust.material.opacity = Math.max(0, 0.85 * (1 - tNorm)); }
        // damage rings fade slowly
        if(effect.damageRings){ effect.damageRings.forEach(r=>{ if(r.material) r.material.opacity = Math.max(0, r.material.opacity - 0.005*this.simSpeed); }); }
        // ocean plume animation
        if(effect.oceanPlume){
          const p = effect.oceanPlume; p.life += 0.016*this.simSpeed; const g = p.group; g.position.add(new THREE.Vector3(0, p.riseSpeed * this.simSpeed, 0)); g.scale.multiplyScalar(1 + 0.02*this.simSpeed);
          if(p.life > p.maxLife){ if(g.parent) this.scene.remove(g); delete effect.oceanPlume; }
        }
        // mushroom cloud animation
        if(effect.mushroom){
          const m = effect.mushroom; m.life += 0.016*this.simSpeed; // rise
          m.group.position.add(new THREE.Vector3(0, m.riseSpeed * this.simSpeed, 0));
          // grow cap and slightly expand stem
          const capScale = 1 + (m.life / m.maxLife) * 4.0;
          if(m.cap) m.cap.scale.setScalar(capScale);
          if(m.stem) m.stem.scale.set(1, 1 + (m.life / m.maxLife) * 2.0, 1);
          // fade over life
          const o = Math.max(0, 0.95 * (1 - (m.life / m.maxLife)));
          if(m.cap && m.cap.material) m.cap.material.opacity = o;
          if(m.stem && m.stem.material) m.stem.material.opacity = Math.max(0.3, o);
          if(m.life > m.maxLife){ if(m.group.parent) this.scene.remove(m.group); delete effect.mushroom; }
        }
      }
      // cleanup when lifetime exceeds
      if(effect.lifetime > (effect.maxLifetime || 3.0)){
        if(effect.mesh && effect.mesh.parent) this.scene.remove(effect.mesh);
        if(effect.flash && effect.flash.parent) this.scene.remove(effect.flash);
        if(effect.dust && effect.dust.parent) this.scene.remove(effect.dust);
        if(effect.damageRings) effect.damageRings.forEach(r=>{ if(r.parent) this.scene.remove(r); });
      }
    });
    // remove fully expired effects
    this.impactEffects = this.impactEffects.filter(e=> e.lifetime <= (e.maxLifetime || 3.0));

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
        const option = document.createElement('option'); option.value = a.id; option.textContent = `${a.name} (${a.estimated_diameter.meters.estimated_diameter_max.toFixed(0)} m)`; select.appendChild(option);
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
    const select = document.getElementById('asteroidSelect'); if(!select.value) return alert('Select an asteroid');
    const details = await this.fetchAsteroidDetails(select.value) || (this.asteroidList||[]).find(a=>a.id===select.value);
    if(!details) return alert('Could not fetch asteroid details');
    const size = details.estimated_diameter.meters.estimated_diameter_max;
    const approach = parseFloat(details.close_approach_data[0].miss_distance.kilometers);
    const velocity = parseFloat(details.close_approach_data[0].relative_velocity.kilometers_per_second);
    document.getElementById('asteroidData').innerHTML = `<b>${details.name}</b><br>Diameter: ${size.toFixed(1)} m<br>Miss distance: ${approach.toFixed(0)} km<br>Velocity: ${velocity.toFixed(1)} km/s`;
    const meteorGeo = new THREE.SphereGeometry(1, 16, 16);
  const meteorMat = new THREE.MeshStandardMaterial({ color:0xaaaaaa, metalness:0.1, roughness:0.6 });
  if(meteorTexture){ meteorMat.map = meteorTexture; meteorMat.needsUpdate = true; }
    const meteor = new THREE.Mesh(meteorGeo, meteorMat);
    const approachMeters = approach * 1000;
    meteor.position.set(0,0, approachMeters / this.SCENE_SCALE);
    const dir = new THREE.Vector3(0,0,-1).normalize();
    // allow UI override of spawned asteroid size
    const overrideCheckbox = document.getElementById('overrideAsteroidSize');
    const sizeEl = document.getElementById('meteorSize');
    const usedSize = (overrideCheckbox && overrideCheckbox.checked && sizeEl) ? parseFloat(sizeEl.value) : size;
    const density = 3000; const volume = (4/3)*Math.PI*Math.pow(usedSize/2,3); const mass = density*volume; const area = Math.PI*Math.pow(usedSize/2,2);
  this.scene.add(meteor);
  const meterToScene = 1/this.SCENE_SCALE;
  const radiusScene = (usedSize / 2) * meterToScene; // size is diameter in meters
  meteor.scale.setScalar(Math.max(radiusScene, 1e-6));
  const label = this.createLabel(`${details.name} (${usedSize.toFixed(0)} m)`, meteor.position);
  // trail
  let trailObj = null;
  try{
    const maxTrail = 80;
    const trailPos = new Float32Array(maxTrail * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setDrawRange(0, 0);
    const trailMat = new THREE.LineBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0.9 });
    const trailLine = new THREE.Line(trailGeo, trailMat);
    trailLine.frustumCulled = false;
    this.scene.add(trailLine);
    trailObj = { line: trailLine, geo: trailGeo, positions: trailPos, max: maxTrail, count: 0 };
  }catch(e){ trailObj = null; }
    // Frame camera to the spawned meteor: position the camera at a distance proportional to size
    try{
      const distanceMeters = Math.max(size * 10, 1000); // aim for ~10x diameter or 1km min
      const distanceScene = distanceMeters / this.SCENE_SCALE;
      const meteorWorldPos = meteor.position.clone();
      // camera end position: along +Z from meteor so it looks toward the origin
      const endCamPos = meteorWorldPos.clone().add(new THREE.Vector3(0, distanceScene * 0.7, distanceScene * 1.2));
      this.frameCameraTo(meteorWorldPos, endCamPos, 1200);
    }catch(e){ console.warn('Framing failed', e); }
  // show size in UI
  const selLabel = document.getElementById('asteroidData'); if(selLabel) selLabel.innerHTML += `<div>Spawned size: ${usedSize.toFixed(0)} m</div>`;
    const physVel = dir.clone().multiplyScalar(velocity*1000);
    this.meteors.push({ mesh:meteor, velocity:dir.multiplyScalar(velocity/50), physVelocity:physVel, active:true, mass, area, size: usedSize, trail: trailObj });
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
