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

    // physics
    this.G = 6.67430e-11;
    this.earthMass = 5.972e24;
    this.earthRadiusMeters = 6371000;
    this.SCENE_SCALE = 1e6; // meters per scene unit
    this.earthRadius = 6371 / 1000; // scene units
    this.gravityStrength = 0.02;

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
    document.body.appendChild(this.renderer.domElement);

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
    if (el('simSpeed')) el('simSpeed').oninput = (e) => { this.simSpeed = parseFloat(e.target.value); if (el('simSpeedVal')) el('simSpeedVal').innerText = parseFloat(e.target.value).toFixed(2); };
    if (el('speed')) { const s = el('speed'); if (el('speedVal')) el('speedVal').innerText = s.value; s.oninput = (e) => { if (el('speedVal')) el('speedVal').innerText = parseFloat(e.target.value).toFixed(2); }; }
    if (el('reset')) el('reset').onclick = () => this.resetScene();
    if (el('pause')) el('pause').onclick = (e) => { this.paused = !this.paused; e.target.innerText = this.paused ? 'Resume' : 'Pause'; };
    if (el('toggleAiming')) el('toggleAiming').onclick = (e) => { this.showAiming = !this.showAiming; e.target.innerText = this.showAiming ? 'Hide Aiming' : 'Show Aiming'; const aim = this.scene.getObjectByName('aimingLine'); if (aim) aim.visible = this.showAiming; };
    if (el('fire')) el('fire').onclick = () => this.shootMeteor();
    if (el('loadMore')) el('loadMore').onclick = () => this.fetchAsteroidList(true);
    if (el('highResTex')) el('highResTex').onclick = () => this.loadHighResEarthTexture();
    const uploadInput = el('uploadTex');
    if (uploadInput) uploadInput.addEventListener('change', (ev) => this.onUploadTexture(ev));
    const realBtn = el('toggleRealism'); if(realBtn) realBtn.onclick = (e)=>{ this.realistic = !this.realistic; e.target.innerText = this.realistic? 'Disable Realistic Physics' : 'Enable Realistic Physics'; };
  const solarBtn = el('toggleSolar'); if(solarBtn) solarBtn.onclick = (e)=>{ this.toggleSolarSystem(e); };
  const dmgBtn = el('toggleDamageOverlay'); if(dmgBtn) dmgBtn.onclick = (e)=>{ this.showDamageOverlay = !this.showDamageOverlay; e.target.innerText = this.showDamageOverlay? 'Hide Damage Overlay' : 'Show Damage Overlay'; };

    // initial aiming visibility
    const aimObj = this.scene.getObjectByName('aimingLine'); if (aimObj) aimObj.visible = this.showAiming;

    // attempt to auto-load a local earth texture file if present (project root: earth_texture.jpg)
    try { this.tryLoadLocalEarthTexture(); } catch(e){ /* ignore */ }
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
    const size = 0.5;
    const meteorGeo = new THREE.SphereGeometry(1, 16, 16);
    const meteorMat = new THREE.MeshStandardMaterial({ color:0x888888, metalness:0.2, roughness:0.5 });
    const meteor = new THREE.Mesh(meteorGeo, meteorMat);
    meteor.position.copy(this.camera.position);
    const dir = new THREE.Vector3().subVectors(this.cursor.position, this.camera.position).normalize();
    const density = 3000;
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
    const visScale = Math.max(radiusScene, 1e-6); // avoid zero scale but keep real size
    meteor.scale.setScalar(visScale);
    this.meteors.push({ mesh:meteor, velocity:dir.multiplyScalar(speed), physVelocity, active:true, label, mass, area, size });
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
      if(r < this.earthRadius + 0.2){
        meteor.active = false;
        this.createImpact(pos.clone());
        this.scene.remove(meteor.mesh);
        if(meteor.label && meteor.label.element && meteor.label.element.parentNode) meteor.label.element.parentNode.removeChild(meteor.label.element);
        const li = this.labels.indexOf(meteor.label); if(li!==-1) this.labels.splice(li,1);
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
    // Compute impact summary (approximate/visualization-oriented)
    const summary = this.computeImpactSummary(position);

    // Update UI summary area (append)
    try{
      const el = document.getElementById('asteroidData');
      if(el){
        const html = `
          <div style="margin-top:8px;padding:8px;background:rgba(0,0,0,0.45);border-radius:6px;">
            <b>Impact Summary</b><br>
            Energy: ${summary.KE.toExponential(3)} J (~${summary.TNT_tons.toFixed(2)} tons TNT, ${summary.Hiroshima_eq.toFixed(2)} Hiroshimas)<br>
            Crater: ${ (summary.craterDiameter_m/1000).toFixed(2) } km diameter, ${ (summary.craterDepth_m).toFixed(2) } m depth<br>
            Atmospheric mass loss: ${( (1-summary.massFraction)*100 ).toFixed(1)}% (remaining mass ${(summary.massFinal).toFixed(1)} kg)
          </div>`;
        el.innerHTML = html + el.innerHTML;
      }
    }catch(e){ console.warn('Failed to update impact UI', e); }

    const normal = position.clone().normalize();

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
    const dustMat = new THREE.MeshStandardMaterial({ color:0x553322, transparent:true, opacity:0.85, roughness:1.0, metalness:0 });
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
    this.impactEffects.push({
      mesh: shock,
      type: 'shock',
      lifetime: 0,
      maxLifetime: 4.0,
      flash,
      dust,
      damageRings
    });
  }

  // Compute approximate impact metrics for visualization
  computeImpactSummary(position){
    // Try to use last-impacting meteor info if available (best-effort)
    // We look for the most-recent inactive meteor near position and use its properties; otherwise fallback to defaults
    let src = null;
    for(let i=this.meteors.length-1;i>=0;i--){
      const m = this.meteors[i];
      if(!m.active){ continue; }
      // if close to position in scene units
      if(m.mesh && m.mesh.position.distanceTo(position) < 1.0){ src = m; break; }
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
    const meteor = new THREE.Mesh(meteorGeo, meteorMat);
    const approachMeters = approach * 1000;
    meteor.position.set(0,0, approachMeters / this.SCENE_SCALE);
    const dir = new THREE.Vector3(0,0,-1).normalize();
    const density = 3000; const volume = (4/3)*Math.PI*Math.pow(size/2,3); const mass = density*volume; const area = Math.PI*Math.pow(size/2,2);
  this.scene.add(meteor);
  const meterToScene = 1/this.SCENE_SCALE;
  const radiusScene = (size / 2) * meterToScene; // size is diameter in meters
  meteor.scale.setScalar(Math.max(radiusScene, 1e-6));
  const label = this.createLabel(`${details.name} (${size.toFixed(0)} m)`, meteor.position);
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
  const selLabel = document.getElementById('asteroidData'); if(selLabel) selLabel.innerHTML += `<div>Spawned size: ${size.toFixed(0)} m</div>`;
    const physVel = dir.clone().multiplyScalar(velocity*1000);
    this.meteors.push({ mesh:meteor, velocity:dir.multiplyScalar(velocity/50), physVelocity:physVel, active:true, mass, area, size });
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
