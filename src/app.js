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
    this.particleSystems = [];
    this.trajectoryLines = [];
    this.simulationStartTime = Date.now();
    this.lastUpdateTime = Date.now();
    
    // Post-processing effects
    this.effectComposer = null;
    this.dofPass = null;
    this.bloomPass = null;
    this.starField = null;
    
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
    
    // Leaflet integration
    this.leafletMap = null;
    this.mapMarkers = [];
    this.mapCircles = [];
    this.mapExpanded = false;
    this.leafletReady = false;

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

    // Advanced atmosphere properties (much larger atmosphere)
    this.atmosphereHeight = 500000; // 500km in meters (increased from 200km)
    this.atmosphereHeightScene = this.atmosphereHeight / this.SCENE_SCALE; // scene units
    this.atmosphereDensity = 0.5; // kg/m³ at sea level (reduced from 1.225)
    this.dragCoefficient = 0.1; // for spherical objects (reduced from 0.47)
    this.burnTemperature = 1500; // Kelvin
    this.burnSpeedThreshold = 2000; // m/s - speed at which burning starts
    
    // Shader materials
    this.shaderMaterials = {};
    this.initShaders();
    
    // Enhanced atmosphere physics
    this.seaLevelPressure = 101325; // Pa (Pascals)
    this.gasConstant = 287; // J/(kg·K) for air
    this.standardTemperature = 288; // K at sea level
    
    // Orbital mechanics (based on NASA elliptical orbit design)
    this.orbitalObjects = [];
    this.orbitalTrails = [];
    this.keplerTolerance = 1.0e-14;
    
    // Tsunami and earthquake effects
    this.tsunamiZones = [];
    this.earthquakeEffects = [];
    
    // Advanced atmosphere layers (extended for much larger atmosphere)
    this.atmosphereLayers = [
      { name: 'Troposphere', height: 12000, density: 0.5, temperature: 288, windSpeed: 10 },
      { name: 'Stratosphere', height: 50000, density: 0.035, temperature: 216, windSpeed: 50 },
      { name: 'Mesosphere', height: 80000, density: 0.0004, temperature: 190, windSpeed: 100 },
      { name: 'Thermosphere', height: 200000, density: 0.00004, temperature: 1000, windSpeed: 200 },
      { name: 'Exosphere', height: 500000, density: 0.000004, temperature: 1500, windSpeed: 300 }
    ];
    
    // Wind system
    this.windDirection = new THREE.Vector3(1, 0, 0);
    this.windStrength = 0.1;

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

  // Create starry skybox
  createStarrySkybox() {
    const geometry = new THREE.SphereGeometry(500, 60, 40);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 }
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        varying vec3 vWorldPosition;
        
        // Random function for star generation
        float random(vec2 st) {
          return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
        }
        
        // Noise function for nebula
        float noise(vec2 st) {
          vec2 i = floor(st);
          vec2 f = fract(st);
          float a = random(i);
          float b = random(i + vec2(1.0, 0.0));
          float c = random(i + vec2(0.0, 1.0));
          float d = random(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }
        
        void main() {
          vec3 direction = normalize(vWorldPosition);
          vec2 uv = vec2(
            atan(direction.z, direction.x) / (2.0 * 3.14159) + 0.5,
            asin(direction.y) / 3.14159 + 0.5
          );
          
          // Generate stars
          vec2 starUV = uv * 100.0;
          vec2 starID = floor(starUV);
          vec2 starPos = fract(starUV);
          
          float star = random(starID);
          if (star > 0.98) {
            float starSize = random(starID + 1.0) * 0.1 + 0.01;
            float starBrightness = random(starID + 2.0) * 0.5 + 0.5;
            float dist = length(starPos - 0.5);
            if (dist < starSize) {
              float twinkle = sin(time * 2.0 + starID.x * 10.0) * 0.3 + 0.7;
              gl_FragColor = vec4(vec3(1.0) * starBrightness * twinkle, 1.0);
              return;
            }
          }
          
          // Generate nebula
          vec2 nebulaUV = uv * 20.0;
          float nebula1 = noise(nebulaUV + time * 0.01) * 0.3;
          float nebula2 = noise(nebulaUV * 2.0 + time * 0.02) * 0.2;
          float nebula3 = noise(nebulaUV * 4.0 + time * 0.03) * 0.1;
          
          vec3 nebulaColor = vec3(
            0.2 + nebula1 * 0.3,
            0.1 + nebula2 * 0.2,
            0.3 + nebula3 * 0.4
          );
          
          // Add some distant galaxies
          float galaxy = noise(uv * 5.0 + time * 0.005) * 0.1;
          nebulaColor += vec3(0.1, 0.05, 0.15) * galaxy;
          
          gl_FragColor = vec4(nebulaColor, 1.0);
        }
      `,
      side: THREE.BackSide
    });
    
    this.starField = new THREE.Mesh(geometry, material);
    this.starField.name = 'starField';
    this.scene.add(this.starField);
  }

  // Initialize shader materials with ray tracing
  initShaders() {
    // Meteor trail shader with ray tracing
    this.shaderMaterials.meteorTrail = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 },
        color: { value: new THREE.Color(0xff4400) },
        opacity: { value: 0.8 },
        lightPosition: { value: new THREE.Vector3(0, 0, 0) },
        cameraPosition: { value: new THREE.Vector3(0, 0, 0) },
        earthPosition: { value: new THREE.Vector3(0, 0, 0) },
        earthRadius: { value: 1.0 }
      },
      vertexShader: `
        uniform vec3 lightPosition;
        uniform vec3 cameraPosition;
        uniform vec3 earthPosition;
        varying vec2 vUv;
        varying vec3 vPosition;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying vec3 vLightDirection;
        varying vec3 vViewDirection;
        varying float vDistanceToEarth;
        
        void main() {
          vUv = uv;
          vPosition = position;
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          vNormal = normalize(normalMatrix * normal);
          
          vLightDirection = normalize(lightPosition - vWorldPosition);
          vViewDirection = normalize(cameraPosition - vWorldPosition);
          vDistanceToEarth = distance(vWorldPosition, earthPosition);
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 color;
        uniform float opacity;
        uniform vec3 lightPosition;
        uniform vec3 cameraPosition;
        uniform vec3 earthPosition;
        uniform float earthRadius;
        varying vec2 vUv;
        varying vec3 vPosition;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying vec3 vLightDirection;
        varying vec3 vViewDirection;
        varying float vDistanceToEarth;
        
        // Simple ray-sphere intersection
        float raySphereIntersect(vec3 rayOrigin, vec3 rayDirection, vec3 sphereCenter, float sphereRadius) {
          vec3 oc = rayOrigin - sphereCenter;
          float a = dot(rayDirection, rayDirection);
          float b = 2.0 * dot(oc, rayDirection);
          float c = dot(oc, oc) - sphereRadius * sphereRadius;
          float discriminant = b * b - 4.0 * a * c;
          
          if (discriminant < 0.0) return -1.0;
          return (-b - sqrt(discriminant)) / (2.0 * a);
        }
        
        // Atmospheric scattering approximation
        vec3 atmosphericScattering(vec3 rayOrigin, vec3 rayDirection, vec3 lightDirection) {
          float earthHit = raySphereIntersect(rayOrigin, rayDirection, earthPosition, earthRadius);
          float atmosphereHit = raySphereIntersect(rayOrigin, rayDirection, earthPosition, earthRadius * 1.1);
          
          if (earthHit > 0.0) return vec3(0.0); // Hit Earth, no scattering
          
          float scatterDistance = atmosphereHit > 0.0 ? atmosphereHit : 100.0;
          float scatterAmount = 1.0 - exp(-scatterDistance * 0.1);
          
          // Rayleigh scattering (blue sky)
          float cosAngle = dot(rayDirection, lightDirection);
          float rayleigh = 3.0 / (16.0 * 3.14159) * (1.0 + cosAngle * cosAngle);
          
          // Mie scattering (white clouds)
          float mie = 1.0 / (4.0 * 3.14159) * (1.0 - cosAngle * cosAngle) / 
                     pow(1.0 + cosAngle * cosAngle - 2.0 * cosAngle, 1.5);
          
          vec3 rayleighColor = vec3(0.3, 0.6, 1.0) * rayleigh;
          vec3 mieColor = vec3(1.0, 1.0, 1.0) * mie * 0.1;
          
          return (rayleighColor + mieColor) * scatterAmount;
        }
        
        void main() {
          // Base fire effect
          float noise = sin(vUv.x * 10.0 + time * 5.0) * 0.1 + 
                       sin(vUv.y * 15.0 + time * 3.0) * 0.05;
          float baseAlpha = (1.0 - vUv.y) * opacity * (0.8 + noise);
          
          // Ray tracing lighting
          vec3 normal = normalize(vNormal);
          float NdotL = max(0.0, dot(normal, vLightDirection));
          float NdotV = max(0.0, dot(normal, vViewDirection));
          
          // Phong lighting model
          vec3 reflectDir = reflect(-vLightDirection, normal);
          float specular = pow(max(0.0, dot(vViewDirection, reflectDir)), 32.0);
          
          // Atmospheric scattering
          vec3 scattering = atmosphericScattering(vWorldPosition, vViewDirection, vLightDirection);
          
          // Combine lighting
          vec3 diffuse = color * NdotL;
          vec3 specularColor = vec3(1.0, 0.8, 0.6) * specular * 0.5;
          vec3 ambient = color * 0.2;
          
          vec3 finalColor = diffuse + specularColor + ambient + scattering;
          
          // Distance-based attenuation
          float distanceAttenuation = 1.0 / (1.0 + vDistanceToEarth * 0.1);
          finalColor *= distanceAttenuation;
          
          gl_FragColor = vec4(finalColor, baseAlpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide
    });

    // Explosion shader with ray tracing
    this.shaderMaterials.explosion = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 },
        intensity: { value: 1.0 },
        color1: { value: new THREE.Color(0xff4400) },
        color2: { value: new THREE.Color(0xffaa00) },
        color3: { value: new THREE.Color(0xffffff) },
        lightPosition: { value: new THREE.Vector3(0, 0, 0) },
        cameraPosition: { value: new THREE.Vector3(0, 0, 0) },
        earthPosition: { value: new THREE.Vector3(0, 0, 0) },
        earthRadius: { value: 1.0 }
      },
      vertexShader: `
        uniform vec3 lightPosition;
        uniform vec3 cameraPosition;
        uniform vec3 earthPosition;
        varying vec2 vUv;
        varying vec3 vPosition;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying vec3 vLightDirection;
        varying vec3 vViewDirection;
        varying float vDistanceToEarth;
        
        void main() {
          vUv = uv;
          vPosition = position;
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          vNormal = normalize(normalMatrix * normal);
          
          vLightDirection = normalize(lightPosition - vWorldPosition);
          vViewDirection = normalize(cameraPosition - vWorldPosition);
          vDistanceToEarth = distance(vWorldPosition, earthPosition);
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float intensity;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec3 lightPosition;
        uniform vec3 cameraPosition;
        uniform vec3 earthPosition;
        uniform float earthRadius;
        varying vec2 vUv;
        varying vec3 vPosition;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying vec3 vLightDirection;
        varying vec3 vViewDirection;
        varying float vDistanceToEarth;
        
        // Ray-sphere intersection for shadows
        float raySphereIntersect(vec3 rayOrigin, vec3 rayDirection, vec3 sphereCenter, float sphereRadius) {
          vec3 oc = rayOrigin - sphereCenter;
          float a = dot(rayDirection, rayDirection);
          float b = 2.0 * dot(oc, rayDirection);
          float c = dot(oc, oc) - sphereRadius * sphereRadius;
          float discriminant = b * b - 4.0 * a * c;
          
          if (discriminant < 0.0) return -1.0;
          return (-b - sqrt(discriminant)) / (2.0 * a);
        }
        
        // Shadow calculation
        float calculateShadow(vec3 worldPos, vec3 lightDir) {
          float shadow = 1.0;
          float earthShadow = raySphereIntersect(worldPos, lightDir, earthPosition, earthRadius);
          if (earthShadow > 0.0 && earthShadow < 100.0) {
            shadow = 0.3; // Soft shadow
          }
          return shadow;
        }
        
        // Volumetric lighting
        vec3 volumetricLighting(vec3 worldPos, vec3 lightDir, float distance) {
          float density = 0.1;
          float scattering = 1.0 - exp(-density * distance);
          return vec3(1.0, 0.8, 0.6) * scattering * 0.5;
        }
        
        void main() {
          float dist = length(vUv - 0.5);
          float pulse = sin(time * 10.0) * 0.1 + 0.9;
          float heat = 1.0 - smoothstep(0.0, 0.5, dist);
          
          // Base explosion colors
          vec3 color = mix(color1, color2, heat);
          color = mix(color, color3, heat * heat);
          
          // Ray tracing lighting
          vec3 normal = normalize(vNormal);
          float NdotL = max(0.0, dot(normal, vLightDirection));
          float NdotV = max(0.0, dot(normal, vViewDirection));
          
          // Shadows
          float shadow = calculateShadow(vWorldPosition, vLightDirection);
          
          // Specular reflection
          vec3 reflectDir = reflect(-vLightDirection, normal);
          float specular = pow(max(0.0, dot(vViewDirection, reflectDir)), 64.0);
          
          // Volumetric effects
          vec3 volumetric = volumetricLighting(vWorldPosition, vLightDirection, vDistanceToEarth);
          
          // Combine lighting
          vec3 diffuse = color * NdotL * shadow;
          vec3 specularColor = vec3(1.0, 1.0, 0.8) * specular * 0.8;
          vec3 ambient = color * 0.3;
          
          vec3 finalColor = diffuse + specularColor + ambient + volumetric;
          
          // Distance-based attenuation
          float distanceAttenuation = 1.0 / (1.0 + vDistanceToEarth * 0.05);
          finalColor *= distanceAttenuation;
          
          float alpha = heat * intensity * pulse * (1.0 - dist * 2.0);
          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide
    });

    // Compiled atmosphere shader with optimized performance
    this.shaderMaterials.atmosphere = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 },
        opacity: { value: 0.4 },
        color: { value: new THREE.Color(0x87CEEB) },
        lightPosition: { value: new THREE.Vector3(0, 0, 0) },
        cameraPosition: { value: new THREE.Vector3(0, 0, 0) },
        earthPosition: { value: new THREE.Vector3(0, 0, 0) },
        earthRadius: { value: 1.0 },
        sunDirection: { value: new THREE.Vector3(0, 0, 1) },
        atmosphereRadius: { value: 1.15 },
        rayleighCoeff: { value: new THREE.Vector3(5.8e-6, 1.35e-5, 3.31e-5) },
        mieCoeff: { value: 2e-5 },
        mieG: { value: 0.76 },
        sunIntensity: { value: 25.0 },
        // Compiled shader optimizations
        invWavelength: { value: new THREE.Vector3(1.0/0.650, 1.0/0.570, 1.0/0.475) },
        scale: { value: 1.0 / (1.15 - 1.0) },
        scaleDepth: { value: 0.25 },
        scaleOverScaleDepth: { value: 4.0 / (1.15 - 1.0) }
      },
      vertexShader: `
        uniform vec3 lightPosition;
        uniform vec3 cameraPosition;
        uniform vec3 earthPosition;
        uniform vec3 sunDirection;
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying vec3 vWorldPosition;
        varying vec3 vLightDirection;
        varying vec3 vViewDirection;
        varying vec3 vSunDirection;
        varying float vDistanceToEarth;
        varying float vAtmosphereHeight;
        
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = position;
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          
          vLightDirection = normalize(lightPosition - vWorldPosition);
          vViewDirection = normalize(cameraPosition - vWorldPosition);
          vSunDirection = normalize(sunDirection);
          vDistanceToEarth = distance(vWorldPosition, earthPosition);
          vAtmosphereHeight = (vDistanceToEarth - 1.0) / 0.1; // Normalized height in atmosphere
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float opacity;
        uniform vec3 color;
        uniform vec3 lightPosition;
        uniform vec3 cameraPosition;
        uniform vec3 earthPosition;
        uniform float earthRadius;
        uniform float atmosphereRadius;
        uniform vec3 sunDirection;
        uniform vec3 rayleighCoeff;
        uniform float mieCoeff;
        uniform float mieG;
        uniform float sunIntensity;
        uniform vec3 invWavelength;
        uniform float scale;
        uniform float scaleDepth;
        uniform float scaleOverScaleDepth;
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying vec3 vWorldPosition;
        varying vec3 vLightDirection;
        varying vec3 vViewDirection;
        varying vec3 vSunDirection;
        varying float vDistanceToEarth;
        varying float vAtmosphereHeight;
        
        const float PI = 3.14159265359;
        const int NUM_SAMPLES = 8; // Reduced for performance
        const int NUM_LIGHT_SAMPLES = 4; // Reduced for performance
        
        // Optimized ray-sphere intersection
        float raySphereIntersect(vec3 rayOrigin, vec3 rayDirection, vec3 sphereCenter, float sphereRadius) {
          vec3 oc = rayOrigin - sphereCenter;
          float b = 2.0 * dot(oc, rayDirection);
          float c = dot(oc, oc) - sphereRadius * sphereRadius;
          float discriminant = b * b - 4.0 * c;
          
          if (discriminant < 0.0) return -1.0;
          return (-b - sqrt(discriminant)) * 0.5;
        }
        
        // Pre-computed Rayleigh phase function
        float rayleighPhase(float cosAngle) {
          return 0.0596831 * (1.0 + cosAngle * cosAngle);
        }
        
        // Pre-computed Mie phase function
        float miePhase(float cosAngle) {
          return 0.119366 * pow(1.0 + 0.5776 - 1.52 * cosAngle, -1.5);
        }
        
        // Optimized density function
        float getDensity(float height) {
          return exp(-height * scale);
        }
        
        // Compiled atmospheric scattering (optimized)
        vec3 integrateScattering(vec3 rayOrigin, vec3 rayDirection, vec3 sunDir) {
          float earthHit = raySphereIntersect(rayOrigin, rayDirection, earthPosition, earthRadius);
          float atmosphereHit = raySphereIntersect(rayOrigin, rayDirection, earthPosition, atmosphereRadius);
          
          if (earthHit > 0.0) return vec3(0.0);
          if (atmosphereHit < 0.0) return vec3(0.0);
          
          float start = max(0.0, atmosphereHit);
          float end = 50.0; // Reduced for performance
          
          float stepSize = (end - start) / float(NUM_SAMPLES);
          vec3 totalRayleigh = vec3(0.0);
          vec3 totalMie = vec3(0.0);
          
          float cosAngle = dot(rayDirection, sunDir);
          float rayleighPhaseValue = rayleighPhase(cosAngle);
          float miePhaseValue = miePhase(cosAngle);
          
          // Optimized sampling loop
          for (int i = 0; i < NUM_SAMPLES; i++) {
            float samplePos = start + float(i) * stepSize;
            vec3 samplePoint = rayOrigin + rayDirection * samplePos;
            
            float height = length(samplePoint - earthPosition) - earthRadius;
            if (height < 0.0) continue;
            
            float density = getDensity(height);
            float sampleStepSize = stepSize * density;
            
            // Simplified light scattering
            float lightHit = raySphereIntersect(samplePoint, sunDir, earthPosition, earthRadius);
            
            if (lightHit < 0.0) {
              float lightHeight = length(samplePoint + sunDir * 10.0 - earthPosition) - earthRadius;
              if (lightHeight >= 0.0) {
                float lightDensity = getDensity(lightHeight);
                vec3 lightTransmittance = exp(-(rayleighCoeff * lightDensity * 10.0 + vec3(lightDensity * mieCoeff * 10.0)));
                totalRayleigh += density * sampleStepSize * lightTransmittance;
                totalMie += density * sampleStepSize * lightTransmittance;
              }
            }
          }
          
          vec3 rayleighScattering = totalRayleigh * rayleighCoeff * rayleighPhaseValue * sunIntensity;
          vec3 mieScattering = totalMie * mieCoeff * miePhaseValue * sunIntensity;
          
          return rayleighScattering + mieScattering;
        }
        
        void main() {
          // Compiled atmospheric scattering
          vec3 scattering = integrateScattering(cameraPosition, vViewDirection, vSunDirection);
          
          // Optimized height-based color
          float heightFactor = clamp(vAtmosphereHeight, 0.0, 1.0);
          vec3 skyColor = mix(vec3(0.3, 0.6, 1.0), vec3(1.0, 0.8, 0.6), heightFactor * 0.3);
          
          // Simplified fresnel
          float fresnel = 1.0 - abs(dot(vNormal, vViewDirection));
          
          // Reduced noise for performance
          float noise = sin(vPosition.x * 0.1 + time * 0.5) * 0.05;
          
          // Final color composition
          vec3 finalColor = skyColor + scattering * 1.5;
          float alpha = (fresnel * 0.3 + 0.7) * opacity * (0.8 + noise);
          
          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      transparent: true,
      side: THREE.BackSide
    });

    // Shockwave shader
    this.shaderMaterials.shockwave = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 },
        radius: { value: 1.0 },
        color: { value: new THREE.Color(0x8B00FF) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float radius;
        uniform vec3 color;
        varying vec2 vUv;
        
        void main() {
          float dist = length(vUv - 0.5);
          float wave = sin(dist * 20.0 - time * 15.0) * 0.5 + 0.5;
          float alpha = (1.0 - smoothstep(0.0, radius, dist)) * wave * 0.8;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide
    });

      // Particle shader with ray tracing
      this.shaderMaterials.particle = new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0.0 },
          color: { value: new THREE.Color(0xff6600) },
          opacity: { value: 1.0 },
          lightPosition: { value: new THREE.Vector3(0, 0, 0) },
          cameraPosition: { value: new THREE.Vector3(0, 0, 0) },
          earthPosition: { value: new THREE.Vector3(0, 0, 0) },
          earthRadius: { value: 1.0 }
        },
        vertexShader: `
          attribute float size;
          attribute float alpha;
          attribute float age;
          uniform vec3 lightPosition;
          uniform vec3 cameraPosition;
          uniform vec3 earthPosition;
          varying float vAlpha;
          varying float vAge;
          varying vec3 vWorldPosition;
          varying vec3 vLightDirection;
          varying vec3 vViewDirection;
          varying float vDistanceToEarth;
          
          void main() {
            vAlpha = alpha;
            vAge = age;
            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
            vLightDirection = normalize(lightPosition - vWorldPosition);
            vViewDirection = normalize(cameraPosition - vWorldPosition);
            vDistanceToEarth = distance(vWorldPosition, earthPosition);
            
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = size * (300.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform float time;
          uniform vec3 color;
          uniform float opacity;
          uniform vec3 lightPosition;
          uniform vec3 cameraPosition;
          uniform vec3 earthPosition;
          uniform float earthRadius;
          varying float vAlpha;
          varying float vAge;
          varying vec3 vWorldPosition;
          varying vec3 vLightDirection;
          varying vec3 vViewDirection;
          varying float vDistanceToEarth;
          
          // Ray-sphere intersection for shadows
          float raySphereIntersect(vec3 rayOrigin, vec3 rayDirection, vec3 sphereCenter, float sphereRadius) {
            vec3 oc = rayOrigin - sphereCenter;
            float a = dot(rayDirection, rayDirection);
            float b = 2.0 * dot(oc, rayDirection);
            float c = dot(oc, oc) - sphereRadius * sphereRadius;
            float discriminant = b * b - 4.0 * a * c;
            
            if (discriminant < 0.0) return -1.0;
            return (-b - sqrt(discriminant)) / (2.0 * a);
          }
          
          // Shadow calculation
          float calculateShadow(vec3 worldPos, vec3 lightDir) {
            float shadow = 1.0;
            float earthShadow = raySphereIntersect(worldPos, lightDir, earthPosition, earthRadius);
            if (earthShadow > 0.0 && earthShadow < 100.0) {
              shadow = 0.4; // Soft shadow
            }
            return shadow;
          }
          
          void main() {
            float dist = length(gl_PointCoord - 0.5);
            if (dist > 0.5) discard;
            
            // Create flickering effect based on age and time
            float flicker = sin(vAge * 20.0 + time * 10.0) * 0.1 + 0.9;
            
            // Create heat distortion effect
            float heat = 1.0 - smoothstep(0.0, 0.5, dist);
            float distortion = sin(dist * 10.0 + time * 5.0) * 0.05;
            
            // Ray tracing lighting
            vec3 normal = vec3(0.0, 0.0, 1.0); // Point sprite normal
            float NdotL = max(0.0, dot(normal, vLightDirection));
            float NdotV = max(0.0, dot(normal, vViewDirection));
            
            // Shadows
            float shadow = calculateShadow(vWorldPosition, vLightDirection);
            
            // Specular reflection
            vec3 reflectDir = reflect(-vLightDirection, normal);
            float specular = pow(max(0.0, dot(vViewDirection, reflectDir)), 16.0);
            
            // Combine lighting
            vec3 diffuse = color * NdotL * shadow;
            vec3 specularColor = vec3(1.0, 0.8, 0.6) * specular * 0.3;
            vec3 ambient = color * 0.3;
            
            vec3 finalColor = diffuse + specularColor + ambient;
            
            // Distance-based attenuation
            float distanceAttenuation = 1.0 / (1.0 + vDistanceToEarth * 0.1);
            finalColor *= distanceAttenuation;
            
            float alpha = (1.0 - dist * 2.0) * vAlpha * opacity * flicker;
            gl_FragColor = vec4(finalColor, alpha);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending
      });
  }

  // Setup post-processing effects
  async setupPostProcessing() {
    try {
      // Import post-processing modules
      const { EffectComposer } = await import('three/addons/postprocessing/EffectComposer.js');
      const { RenderPass } = await import('three/addons/postprocessing/RenderPass.js');
      const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js');
      const { BokehPass } = await import('three/addons/postprocessing/BokehPass.js');
      
      // Create effect composer
      this.effectComposer = new EffectComposer(this.renderer);
      
      // Add render pass
      const renderPass = new RenderPass(this.scene, this.camera);
      this.effectComposer.addPass(renderPass);
      
      // Add bloom pass for glowing effects
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.5, // strength
        0.4, // radius
        0.85 // threshold
      );
      this.effectComposer.addPass(this.bloomPass);
      
      // Add depth of field pass
      this.dofPass = new BokehPass(this.scene, this.camera, {
        focus: 10.0,
        aperture: 0.025,
        maxblur: 0.01,
        width: window.innerWidth,
        height: window.innerHeight
      });
      this.effectComposer.addPass(this.dofPass);
      
      console.log('Post-processing effects enabled successfully');
    } catch (error) {
      console.warn('Failed to load post-processing effects:', error);
      console.log('Falling back to standard rendering');
      this.effectComposer = null;
    }
  }

  async init() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 10000);
    this.camera.position.set(0, 3, 15);
    this.scene.add(this.camera);
    
    // Create starry skybox
    this.createStarrySkybox();

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    // Ensure correct color space for loaded textures
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    document.body.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    
    // Setup post-processing effects
    await this.setupPostProcessing();

    // Earth
    const earthGeo = new THREE.SphereGeometry(this.earthRadius, 32, 32);
    const earthMat = new THREE.MeshPhongMaterial({ 
      color: 0x2233ff,
      shininess: 30,
      specular: 0x111111
    });
    const earth = new THREE.Mesh(earthGeo, earthMat);
    earth.name = 'earth';
    this.scene.add(earth);
    this.createLabel('Earth', new THREE.Vector3(0, this.earthRadius + 0.2, 0));

    // Atmosphere visualization with shader
    const atmosphereGeo = new THREE.SphereGeometry(this.earthRadius + this.atmosphereHeightScene, 32, 32);
    const atmosphere = new THREE.Mesh(atmosphereGeo, this.shaderMaterials.atmosphere);
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
    if (el('fetch')) el('fetch').onclick = () => this.fetchAsteroidList(false);
    if (el('loadMore')) el('loadMore').onclick = () => this.fetchAsteroidList(true);
    if (el('highResTex')) el('highResTex').onclick = () => this.loadHighResEarthTexture();
    const uploadInput = el('uploadTex');
    if (uploadInput) uploadInput.addEventListener('change', (ev) => this.onUploadTexture(ev));
    const realBtn = el('toggleRealism'); if(realBtn) realBtn.onclick = (e)=>{ this.realistic = !this.realistic; e.target.innerText = this.realistic? 'Disable Realistic Physics' : 'Enable Realistic Physics'; };
    const atmBtn = el('toggleAtmosphere'); if(atmBtn) atmBtn.onclick = (e)=>{ this.showAtmosphere = !this.showAtmosphere; e.target.innerText = this.showAtmosphere? 'Hide Atmosphere' : 'Show Atmosphere'; const atm = this.scene.getObjectByName('atmosphere'); if(atm) atm.visible = this.showAtmosphere; };
    const moonBtn = el('toggleMoon'); if(moonBtn) moonBtn.onclick = (e)=>{ this.showMoon = !this.showMoon; e.target.innerText = this.showMoon? 'Hide Moon' : 'Show Moon'; const moon = this.scene.getObjectByName('moon'); if(moon) moon.visible = this.showMoon; };
    const gravityBtn = el('toggleGravityViz'); if(gravityBtn) gravityBtn.onclick = (e)=>{ this.showGravityViz = !this.showGravityViz; e.target.innerText = this.showGravityViz? 'Hide Gravity Fields' : 'Show Gravity Fields'; this.toggleGravityVisualizers(); };
    if (el('selectAsteroid')) el('selectAsteroid').onclick = () => this.selectAsteroid();
    if (el('toggleMapSize')) el('toggleMapSize').onclick = () => this.toggleMapSize();
    if (el('createOrbit')) el('createOrbit').onclick = () => this.createRandomOrbit();
    
    // Camera focus buttons
    if (el('focusEarth')) el('focusEarth').onclick = () => this.focusOnEarth();
    if (el('focusMoon')) el('focusMoon').onclick = () => this.focusOnMoon();
    if (el('focusMeteor')) el('focusMeteor').onclick = () => this.focusOnLastMeteor();
    if (el('focusFree')) el('focusFree').onclick = () => this.setFreeCamera();

    // initial aiming visibility
    const aimObj = this.scene.getObjectByName('aimingLine'); if (aimObj) aimObj.visible = this.showAiming;

    // attempt to auto-load a local earth texture file if present (project root: earth_texture.jpg)
    try { this.tryLoadLocalEarthTexture(); } catch(e){ /* ignore */ }
    
    // Make debug function available globally
    window.debugEarthTexture = () => this.debugEarthTexture();
    window.togglePostProcessing = () => this.togglePostProcessing();
    window.adjustBloom = (strength) => this.adjustBloom(strength);
    
    // Initialize map
    this.initMap();
    
    // Initialize Leaflet if available
    if (typeof L !== 'undefined') {
      this.initLeafletMap();
      // Load tsunami zones after map is ready
      setTimeout(() => this.loadTsunamiZones(), 1000);
    } else {
      // Set up callback for when Leaflet loads
      window.initLeafletMap = () => this.initLeafletMap();
    }
  }

  tryLoadLocalEarthTexture(){
    const localPath = './earth_texture.jpg';
    const loader = new THREE.TextureLoader();
    loader.load(localPath, tex => {
      const earth = this.scene.getObjectByName('earth');
      if(earth && earth.material){
        console.log('Found Earth object, applying texture...');
        if(earth.material.color) earth.material.color.setHex(0xffffff);
        tex.encoding = THREE.sRGBEncoding;
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        earth.material.map = tex; 
        earth.material.needsUpdate = true;
        console.log('Successfully loaded local earth texture:', localPath);
        console.log('Earth material after texture load:', earth.material);
      } else {
        console.warn('Earth object not found or has no material');
      }
    }, undefined, err => {
      // silent fail if not present or CORS
      console.debug('Local earth texture not found or failed to load:', localPath, err && err.message);
    });
  }

  // Debug function to manually test texture loading
  debugEarthTexture() {
    const earth = this.scene.getObjectByName('earth');
    if (!earth) {
      console.error('Earth object not found!');
      return;
    }
    console.log('Earth object found:', earth);
    console.log('Earth material:', earth.material);
    console.log('Earth material map:', earth.material.map);
    console.log('Earth material color:', earth.material.color);
    
    // Try to load texture manually
    this.tryLoadLocalEarthTexture();
  }

  // Toggle post-processing effects
  togglePostProcessing() {
    if (this.effectComposer) {
      console.log('Post-processing effects are currently enabled');
      console.log('Effect composer:', this.effectComposer);
      console.log('Bloom pass:', this.bloomPass);
      console.log('DOF pass:', this.dofPass);
    } else {
      console.log('Post-processing effects are disabled');
      console.log('Attempting to re-enable...');
      this.setupPostProcessing();
    }
  }

  // Adjust bloom effect strength
  adjustBloom(strength) {
    if (this.bloomPass) {
      this.bloomPass.strength = Math.max(0, Math.min(3, strength));
      console.log('Bloom strength set to:', this.bloomPass.strength);
    } else {
      console.log('Bloom pass not available');
    }
  }

  onUploadTexture(ev) {
    const f = ev.target.files && ev.target.files[0];
    if(!f) return;
    const url = URL.createObjectURL(f);
    const loader = new THREE.TextureLoader();
    loader.load(url, tex=>{
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      if(this.scene){
        const earth = this.scene.getObjectByName('earth');
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
      
      // Improved camera distance calculation for smaller meteors
      let cameraDistance;
      if (meteorSizeScene < this.earthRadius * 0.01) {
        // Very small meteors - zoom in much closer
        cameraDistance = Math.max(meteorSizeScene * 50, this.earthRadius * 0.1);
      } else if (meteorSizeScene < this.earthRadius * 0.1) {
        // Small meteors - moderate zoom
        cameraDistance = Math.max(meteorSizeScene * 30, this.earthRadius * 0.2);
      } else {
        // Large meteors - standard distance
        cameraDistance = Math.max(meteorSizeScene * 20, this.earthRadius * 0.5);
      }
      
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
      
      // Improved camera distance calculation for smaller meteors
      let cameraDistance;
      if (meteorSizeScene < this.earthRadius * 0.01) {
        // Very small meteors - zoom in much closer
        cameraDistance = Math.max(meteorSizeScene * 50, this.earthRadius * 0.1);
      } else if (meteorSizeScene < this.earthRadius * 0.1) {
        // Small meteors - moderate zoom
        cameraDistance = Math.max(meteorSizeScene * 30, this.earthRadius * 0.2);
      } else {
        // Large meteors - standard distance
        cameraDistance = Math.max(meteorSizeScene * 20, this.earthRadius * 0.5);
      }
      
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

  // Calculate atmospheric density at given altitude using layered model
  getAtmosphericDensity(altitude) {
    if (altitude < 0) return this.atmosphereDensity; // Below surface
    
    // Find which layer the altitude is in
    let currentLayer = this.atmosphereLayers[0];
    for (let i = 0; i < this.atmosphereLayers.length; i++) {
      if (altitude <= this.atmosphereLayers[i].height) {
        currentLayer = this.atmosphereLayers[i];
        break;
      }
    }
    
    // Interpolate density within the layer
    const layerIndex = this.atmosphereLayers.indexOf(currentLayer);
    if (layerIndex === 0) {
      // Troposphere - exponential decay
      const scaleHeight = 8400;
      return this.atmosphereDensity * Math.exp(-altitude / scaleHeight);
    } else {
      // Other layers - linear interpolation
      const prevLayer = this.atmosphereLayers[layerIndex - 1];
      const layerHeight = currentLayer.height - prevLayer.height;
      const altitudeInLayer = altitude - prevLayer.height;
      const ratio = altitudeInLayer / layerHeight;
      
      // Exponential interpolation for more realistic density
      const densityRatio = Math.exp(-ratio * 2);
      return prevLayer.density * densityRatio;
    }
  }

  // Get wind force at given altitude
  getWindForce(altitude) {
    if (altitude < 0 || altitude > this.atmosphereHeight) return new THREE.Vector3();
    
    // Find wind speed for altitude
    let windSpeed = 0;
    for (let i = 0; i < this.atmosphereLayers.length; i++) {
      if (altitude <= this.atmosphereLayers[i].height) {
        windSpeed = this.atmosphereLayers[i].windSpeed;
        break;
      }
    }
    
    // Add some randomness to wind direction
    const windDir = this.windDirection.clone();
    windDir.x += (Math.random() - 0.5) * 0.2;
    windDir.z += (Math.random() - 0.5) * 0.2;
    windDir.normalize();
    
    return windDir.multiplyScalar(windSpeed * this.windStrength);
  }

  // Calculate atmospheric pressure at given altitude
  getAtmosphericPressure(altitude) {
    if (altitude < 0) return this.seaLevelPressure;
    
    // Barometric formula: P = P0 * exp(-g * h / (R * T))
    const g = 9.81; // gravitational acceleration
    const h = altitude;
    const R = this.gasConstant;
    const T = this.standardTemperature;
    
    return this.seaLevelPressure * Math.exp(-g * h / (R * T));
  }

  // Calculate terminal velocity for meteor
  calculateTerminalVelocity(meteor, altitude) {
    const density = this.getAtmosphericDensity(altitude);
    const area = meteor.area || Math.PI * Math.pow(meteor.size / 2, 2);
    const mass = meteor.mass;
    
    // Terminal velocity: v = sqrt(2 * m * g / (ρ * A * Cd))
    const g = 9.81;
    const terminalVelocity = Math.sqrt((2 * mass * g) / (density * area * this.dragCoefficient));
    
    return terminalVelocity;
  }

  // Calculate mass reduction due to atmospheric ablation with enhanced physics
  calculateMassReduction(meteor, dt) {
    const altitude = meteor.mesh.position.length() * this.SCENE_SCALE - this.earthRadiusMeters;
    if (altitude < 0 || altitude > this.atmosphereHeight) return 0;
    
    const density = this.getAtmosphericDensity(altitude);
    const pressure = this.getAtmosphericPressure(altitude);
    const speed = meteor.physVelocity ? meteor.physVelocity.length() : meteor.velocity.length() * this.SCENE_SCALE;
    
    if (speed < this.burnSpeedThreshold) return 0;
    
    // Enhanced ablation calculation based on pressure and density
    const ablationCoefficient = 0.002 * (pressure / this.seaLevelPressure); // Pressure-dependent ablation
    const area = meteor.area || Math.PI * Math.pow(meteor.size / 2, 2);
    const ablationRate = ablationCoefficient * density * speed * speed * area;
    
    // Calculate mass loss
    const massLoss = ablationRate * dt;
    
    // Update meteor mass and size
    if (meteor.mass > massLoss) {
      meteor.mass -= massLoss;
      
      // Update size based on mass reduction (assuming constant density)
      const originalVolume = (4/3) * Math.PI * Math.pow(meteor.size / 2, 3);
      const meteorDensity = meteor.mass / originalVolume;
      const newVolume = meteor.mass / meteorDensity;
      const newRadius = Math.pow((3 * newVolume) / (4 * Math.PI), 1/3);
      meteor.size = newRadius * 2;
      
      // Update area
      meteor.area = Math.PI * Math.pow(meteor.size / 2, 2);
      
      // Scale the mesh
      const radiusMeters = meteor.size / 2;
      const radiusScene = radiusMeters / this.SCENE_SCALE;
      meteor.mesh.scale.setScalar(Math.max(radiusScene, 1e-6));
      
      return massLoss;
    }
    
    return 0;
  }

  // Create particle fire trail for burning meteors
  createFireTrail(meteor) {
    if (!meteor.burning || meteor.fireTrail) return;
    
    const particleCount = 300;
    const geometry = new THREE.BufferGeometry();
    
    // Create particle positions
    const positions = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const alphas = new Float32Array(particleCount);
    const velocities = new Float32Array(particleCount * 3);
    const ages = new Float32Array(particleCount);
    
    // Initialize particles
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      // Start particles at meteor position
      positions[i3] = meteor.position.x;
      positions[i3 + 1] = meteor.position.y;
      positions[i3 + 2] = meteor.position.z;
      
      // Random sizes and alphas
      sizes[i] = Math.random() * 0.03 + 0.01;
      alphas[i] = Math.random() * 0.9 + 0.1;
      ages[i] = Math.random(); // Random age for variety
      
      // Random velocities for particle movement (trail behind meteor)
      const speed = Math.random() * 0.05 + 0.02;
      const angle = Math.random() * Math.PI * 2;
      velocities[i3] = Math.cos(angle) * speed;
      velocities[i3 + 1] = Math.sin(angle) * speed;
      velocities[i3 + 2] = -Math.random() * 0.1; // Trail behind
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute('age', new THREE.BufferAttribute(ages, 1));
    
    const particleMaterial = this.shaderMaterials.particle.clone();
    const fireTrail = new THREE.Points(geometry, particleMaterial);
    fireTrail.name = 'fireTrail';
    meteor.fireTrail = fireTrail;
    meteor.trailSegments = [];
    meteor.trailLength = 0;
    meteor.fireTrail.userData = {
      velocities: velocities,
      ages: ages,
      particleCount: particleCount,
      lastUpdate: 0,
      maxAge: 2.0 // Particles live for 2 seconds
    };
    
    this.scene.add(fireTrail);
  }

  // Update particle fire trail
  updateFireTrail(meteor) {
    if (!meteor.fireTrail || !meteor.burning) return;
    
    const userData = meteor.fireTrail.userData;
    const positions = meteor.fireTrail.geometry.attributes.position.array;
    const alphas = meteor.fireTrail.geometry.attributes.alpha.array;
    const ages = meteor.fireTrail.geometry.attributes.age.array;
    const velocities = userData.velocities;
    const deltaTime = 0.016; // ~60fps
    
    const velocity = meteor.physVelocity || meteor.velocity;
    const speed = velocity.length();
    const burnIntensity = meteor.burnIntensity || 0;
    
    // Update each particle
    for (let i = 0; i < userData.particleCount; i++) {
      const i3 = i * 3;
      
      // Age the particle
      ages[i] += deltaTime;
      
      // If particle is too old, reset it at meteor position
      if (ages[i] > userData.maxAge) {
        ages[i] = 0;
        positions[i3] = meteor.position.x;
        positions[i3 + 1] = meteor.position.y;
        positions[i3 + 2] = meteor.position.z;
        
        // Reset with new random properties
        alphas[i] = Math.random() * 0.9 + 0.1;
        
        // New velocity based on meteor direction
        const direction = velocity.clone().normalize();
        const speedVariation = Math.random() * 0.05 + 0.02;
        const angle = Math.random() * Math.PI * 2;
        const perpendicular = new THREE.Vector3(
          Math.cos(angle),
          Math.sin(angle),
          0
        );
        
        velocities[i3] = -direction.x * speedVariation + perpendicular.x * 0.02;
        velocities[i3 + 1] = -direction.y * speedVariation + perpendicular.y * 0.02;
        velocities[i3 + 2] = -direction.z * speedVariation + perpendicular.z * 0.02;
      } else {
        // Update particle position
        positions[i3] += velocities[i3] * deltaTime;
        positions[i3 + 1] += velocities[i3 + 1] * deltaTime;
        positions[i3 + 2] += velocities[i3 + 2] * deltaTime;
        
        // Fade out over time
        const ageRatio = ages[i] / userData.maxAge;
        alphas[i] = (1 - ageRatio) * (0.8 + burnIntensity * 0.2);
      }
    }
    
    // Mark attributes as needing update
    meteor.fireTrail.geometry.attributes.position.needsUpdate = true;
    meteor.fireTrail.geometry.attributes.alpha.needsUpdate = true;
    meteor.fireTrail.geometry.attributes.age.needsUpdate = true;
    
    // Update shader uniforms
    const material = meteor.fireTrail.material;
    const hue = 0.1 - burnIntensity * 0.1; // Red to orange to yellow
    material.uniforms.time.value = Date.now() * 0.001;
    material.uniforms.color.value.setHSL(hue, 1, 0.5 + burnIntensity * 0.3);
    material.uniforms.opacity.value = 0.7 + burnIntensity * 0.3;
  }

  // Kepler's equation solver (based on NASA design)
  keplerStart3(e, M) {
    const t34 = e * e;
    const t35 = e * t34;
    const t33 = Math.cos(M);
    return M + (-0.5 * t35 + e + (t34 + 1.5 * t33 * t35) * t33) * Math.sin(M);
  }

  eps3(e, M, x) {
    const t1 = Math.cos(x);
    const t2 = -1 + e * t1;
    const t3 = Math.sin(x);
    const t4 = e * t3;
    const t5 = -x + t4 + M;
    const t6 = t5 / (0.5 * t5 * t4 / t2 + t2);
    return t5 / ((0.5 * t3 - (1/6) * t1 * t6) * e * t6 + t2);
  }

  keplerSolve(e, M) {
    const Mnorm = M % (2 * Math.PI);
    let E0 = this.keplerStart3(e, Mnorm);
    let dE = this.keplerTolerance + 1;
    let count = 0;

    while (dE > this.keplerTolerance) {
      const E = E0 - this.eps3(e, Mnorm, E0);
      dE = Math.abs(E - E0);
      E0 = E;
      count++;
      
      if (count === 100) {
        console.warn("KeplerSolve failed to converge!");
        break;
      }
    }
    return E0;
  }

  // Create orbital object
  createOrbitalObject(orbitalParams) {
    const {
      semiMajorAxis = 1000000, // meters
      eccentricity = 0.1,
      inclination = Math.PI / 6, // 30 degrees
      longitudeOfAscendingNode = 0,
      argumentOfPeriapsis = 0,
      meanAnomaly = 0,
      period = 3600, // seconds
      color = 0x00ff00,
      size = 1000
    } = orbitalParams;

    // Create orbital object mesh
    const geometry = new THREE.SphereGeometry(size / this.SCENE_SCALE, 8, 6);
    const material = new THREE.MeshBasicMaterial({ color: color });
    const mesh = new THREE.Mesh(geometry, material);
    
    // Create orbital trail
    const trailGeometry = new THREE.BufferGeometry();
    const trailMaterial = new THREE.LineBasicMaterial({ 
      color: color, 
      transparent: true, 
      opacity: 0.6 
    });
    const trail = new THREE.Line(trailGeometry, trailMaterial);
    
    const orbitalObject = {
      mesh: mesh,
      trail: trail,
      orbitalParams: {
        a: semiMajorAxis,
        e: eccentricity,
        i: inclination,
        Ω: longitudeOfAscendingNode,
        ω: argumentOfPeriapsis,
        M: meanAnomaly,
        T: period,
        n: 2 * Math.PI / period // mean motion
      },
      currentTime: 0,
      trailPoints: []
    };
    
    this.scene.add(mesh);
    this.scene.add(trail);
    this.orbitalObjects.push(orbitalObject);
    
    return orbitalObject;
  }

  // Propagate orbital object (based on NASA design)
  propagateOrbit(orbitalObject, timeStep) {
    const { a, e, i, Ω, ω, n } = orbitalObject.orbitalParams;
    
    // Update mean anomaly
    orbitalObject.currentTime += timeStep;
    const M = n * orbitalObject.currentTime;
    
    // Solve Kepler's equation
    const E = this.keplerSolve(e, M);
    
    // Calculate position in orbital plane
    const cosE = Math.cos(E);
    const sinE = Math.sin(E);
    const r = a * (1 - e * cosE);
    
    const s_x = r * ((cosE - e) / (1 - e * cosE));
    const s_y = r * ((Math.sqrt(1 - e * e) * sinE) / (1 - e * cosE));
    const s_z = 0;
    
    // Apply 3D rotations (pitch, yaw, roll)
    let point = new THREE.Vector3(s_x, s_y, s_z);
    
    // Pitch ~ inclination (rotate around Y axis)
    point.applyAxisAngle(new THREE.Vector3(0, 1, 0), i);
    
    // Yaw ~ longitude of ascending node (rotate around Z axis)
    point.applyAxisAngle(new THREE.Vector3(0, 0, 1), Ω);
    
    // Roll ~ argument of periapsis (rotate around X axis)
    point.applyAxisAngle(new THREE.Vector3(1, 0, 0), ω);
    
    // Convert to scene coordinates
    point.divideScalar(this.SCENE_SCALE);
    
    // Update mesh position
    orbitalObject.mesh.position.copy(point);
    
    // Update trail
    orbitalObject.trailPoints.push(point.clone());
    if (orbitalObject.trailPoints.length > 200) {
      orbitalObject.trailPoints.shift();
    }
    
    if (orbitalObject.trailPoints.length > 1) {
      orbitalObject.trail.geometry.setFromPoints(orbitalObject.trailPoints);
    }
    
    return point;
  }

  // Initialize Leaflet Map
  initLeafletMap() {
    if (typeof L === 'undefined') {
      console.warn('Leaflet not loaded - using fallback canvas map');
      this.initFallbackMap();
      return;
    }
    
    this.leafletReady = true;
    
    const mapElement = document.getElementById('googleMap');
    if (!mapElement) return;
    
    // Initialize the map
    this.leafletMap = L.map('googleMap', {
      center: [0, 0],
      zoom: 2,
      zoomControl: true,
      attributionControl: false
    });
    
    // Add tile layer (using OpenStreetMap)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18
    }).addTo(this.leafletMap);
    
    // Add dark theme tile layer option
    const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors, © CARTO',
      maxZoom: 18
    });
    
    // Add satellite tile layer option
    const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© Esri',
      maxZoom: 18
    });
    
    // Add layer control
    const baseMaps = {
      "OpenStreetMap": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18
      }),
      "Dark Theme": darkLayer,
      "Satellite": satelliteLayer
    };
    
    L.control.layers(baseMaps).addTo(this.leafletMap);
    
    console.log('Leaflet map initialized');
  }

  // Fallback map when Leaflet is not available
  initFallbackMap() {
    const mapElement = document.getElementById('googleMap');
    if (!mapElement) return;
    
    // Create a simple canvas fallback
    const canvas = document.createElement('canvas');
    canvas.width = mapElement.offsetWidth;
    canvas.height = mapElement.offsetHeight;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.background = '#000';
    
    const ctx = canvas.getContext('2d');
    
    // Draw a simple world map
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = '#666';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Leaflet Map Library Not Available', canvas.width / 2, canvas.height / 2);
    ctx.fillText('Check internet connection', canvas.width / 2, canvas.height / 2 + 20);
    ctx.fillText('or CDN access', canvas.width / 2, canvas.height / 2 + 40);
    
    mapElement.appendChild(canvas);
    
    console.log('Fallback map initialized');
  }

  // Add impact marker to Leaflet map
  addImpactToLeafletMap(lat, lon, energy, blastRadius) {
    if (!this.leafletReady || !this.leafletMap) return;
    
    const kilotons = energy / 4.184e12;
    
    // Create custom marker icon
    const markerSize = Math.max(16, Math.min(40, Math.log10(kilotons + 1) * 6));
    const markerColor = kilotons > 1 ? '#ff4444' : '#ffaa44';
    
    const customIcon = L.divIcon({
      className: 'custom-marker',
      html: `
        <div style="
          width: ${markerSize}px;
          height: ${markerSize}px;
          border-radius: 50%;
          background-color: ${markerColor};
          border: 2px solid #ffffff;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: ${markerSize * 0.4}px;
          font-weight: bold;
          color: #ffffff;
          cursor: pointer;
        ">💥</div>
      `,
      iconSize: [markerSize, markerSize],
      iconAnchor: [markerSize / 2, markerSize / 2]
    });
    
    // Create marker
    const marker = L.marker([lat, lon], {
      icon: customIcon,
      title: `Impact: ${kilotons.toFixed(2)} kt`
    }).addTo(this.leafletMap);
    
    // Create popup content
    const popupContent = `
      <div style="color: #e6eef8; font-family: Arial, sans-serif; min-width: 200px;">
        <h3 style="margin: 0 0 8px 0; color: #cfe6ff;">Meteor Impact</h3>
        <p style="margin: 4px 0;"><strong>Energy:</strong> ${kilotons.toFixed(2)} kt</p>
        <p style="margin: 4px 0;"><strong>Blast Radius:</strong> ${blastRadius.toFixed(1)} km</p>
        <p style="margin: 4px 0;"><strong>Location:</strong> ${lat.toFixed(4)}°, ${lon.toFixed(4)}°</p>
      </div>
    `;
    
    marker.bindPopup(popupContent, {
      className: 'custom-popup',
      maxWidth: 250
    });
    
    this.mapMarkers.push(marker);
    
    // Create blast radius circle
    if (blastRadius > 0) {
      const circle = L.circle([lat, lon], {
        color: markerColor,
        fillColor: markerColor,
        fillOpacity: 0.2,
        radius: blastRadius * 1000 // Convert km to meters
      }).addTo(this.leafletMap);
      
      this.mapCircles.push(circle);
    }
    
    // Create effect areas (death/life percentage zones)
    this.createEffectAreas(lat, lon, blastRadius);
    
    // Auto-zoom to impact area
    this.autoZoomToImpact(lat, lon, blastRadius);
  }

  // Calculate blast radius based on energy
  calculateBlastRadius(energy) {
    const kilotons = energy / 4.184e12;
    // Simplified blast radius calculation (km)
    return Math.pow(kilotons, 0.33) * 0.5;
  }

  // Create effect areas showing death/life percentage zones
  createEffectAreas(lat, lon, blastRadius) {
    if (!this.leafletReady || !this.leafletMap) return;
    
    const effectZones = [
      { radius: blastRadius * 0.1, color: '#000000', opacity: 0.8, label: 'Instant Death (100%)' },
      { radius: blastRadius * 0.3, color: '#ff0000', opacity: 0.6, label: 'Severe Burns (90%)' },
      { radius: blastRadius * 0.5, color: '#ff8800', opacity: 0.5, label: 'Third Degree Burns (70%)' },
      { radius: blastRadius * 0.7, color: '#ffaa00', opacity: 0.4, label: 'Second Degree Burns (50%)' },
      { radius: blastRadius * 0.9, color: '#0000ff', opacity: 0.3, label: 'First Degree Burns (30%)' },
      { radius: blastRadius * 1.2, color: '#00ff00', opacity: 0.2, label: 'Minor Injuries (10%)' }
    ];
    
    effectZones.forEach((zone, index) => {
      const circle = L.circle([lat, lon], {
        color: zone.color,
        fillColor: zone.color,
        fillOpacity: zone.opacity,
        radius: zone.radius * 1000, // Convert km to meters
        weight: 2
      }).addTo(this.leafletMap);
      
      // Add popup with zone information
      circle.bindPopup(`
        <div style="color: #e6eef8; font-family: Arial, sans-serif;">
          <h4 style="margin: 0 0 8px 0; color: #cfe6ff;">${zone.label}</h4>
          <p style="margin: 4px 0;"><strong>Radius:</strong> ${zone.radius.toFixed(1)} km</p>
        </div>
      `);
      
      this.mapCircles.push(circle);
    });
  }

  // Auto-zoom to impact area
  autoZoomToImpact(lat, lon, blastRadius) {
    if (!this.leafletReady || !this.leafletMap) return;
    
    // Calculate appropriate zoom level based on blast radius
    const maxRadius = Math.max(blastRadius * 1.5, 10); // At least 10km view
    const bounds = L.latLngBounds(
      [lat - maxRadius / 111, lon - maxRadius / (111 * Math.cos(lat * Math.PI / 180))],
      [lat + maxRadius / 111, lon + maxRadius / (111 * Math.cos(lat * Math.PI / 180))]
    );
    
    // Smooth zoom to the impact area
    this.leafletMap.fitBounds(bounds, { padding: [20, 20] });
  }

  // Load tsunami zones from USGS data
  async loadTsunamiZones() {
    try {
      // Simulated tsunami zone data (in real implementation, would fetch from USGS API)
      const tsunamiZoneData = [
        { name: "Pacific Ring of Fire", lat: 0, lon: -180, radius: 50000, risk: "High" },
        { name: "Japan Trench", lat: 38, lon: 142, radius: 20000, risk: "Very High" },
        { name: "Cascadia Subduction", lat: 45, lon: -125, radius: 30000, risk: "High" },
        { name: "Sumatra Trench", lat: -3, lon: 100, radius: 25000, risk: "Very High" },
        { name: "Chile Trench", lat: -20, lon: -70, radius: 15000, risk: "High" },
        { name: "Aleutian Trench", lat: 52, lon: -175, radius: 20000, risk: "High" }
      ];
      
      tsunamiZoneData.forEach(zone => {
        this.addTsunamiZone(zone);
      });
      
      console.log('Loaded tsunami zones:', tsunamiZoneData.length);
    } catch (error) {
      console.error('Error loading tsunami zones:', error);
    }
  }

  // Add tsunami zone to map
  addTsunamiZone(zoneData) {
    if (!this.leafletReady || !this.leafletMap) return;
    
    const { name, lat, lon, radius, risk } = zoneData;
    
    // Color based on risk level
    const colors = {
      'Low': '#00ff00',
      'Medium': '#ffff00', 
      'High': '#ff8800',
      'Very High': '#ff0000'
    };
    
    const color = colors[risk] || '#ff8800';
    
    // Create tsunami zone circle
    const tsunamiZone = L.circle([lat, lon], {
      color: color,
      fillColor: color,
      fillOpacity: 0.1,
      radius: radius * 1000, // Convert km to meters
      weight: 2,
      dashArray: '10, 5'
    }).addTo(this.leafletMap);
    
    // Add popup
    tsunamiZone.bindPopup(`
      <div style="color: #e6eef8; font-family: Arial, sans-serif;">
        <h4 style="margin: 0 0 8px 0; color: #cfe6ff;">${name}</h4>
        <p style="margin: 4px 0;"><strong>Risk Level:</strong> ${risk}</p>
        <p style="margin: 4px 0;"><strong>Radius:</strong> ${radius} km</p>
        <p style="margin: 4px 0;"><strong>Type:</strong> Tsunami Zone</p>
      </div>
    `);
    
    this.tsunamiZones.push(tsunamiZone);
  }

  // Calculate earthquake effects after meteor impact
  calculateEarthquakeEffects(lat, lon, energy) {
    const kilotons = energy / 4.184e12;
    
    // Calculate earthquake magnitude based on impact energy
    // Using empirical relationship: Mw ≈ log10(energy) - 4.4
    const magnitude = Math.log10(kilotons * 4.184e12) - 4.4;
    
    // Calculate earthquake radius based on magnitude
    const earthquakeRadius = Math.pow(10, (magnitude - 2.5) / 1.5) * 10; // km
    
    // Create earthquake effect on map
    this.addEarthquakeEffect(lat, lon, magnitude, earthquakeRadius);
    
    // Check for tsunami generation if impact is in ocean
    if (this.isOceanImpact(lat, lon)) {
      this.generateTsunami(lat, lon, magnitude, earthquakeRadius);
    }
    
    console.log(`Earthquake: M${magnitude.toFixed(1)} with ${earthquakeRadius.toFixed(1)}km radius`);
  }

  // Add earthquake effect to map
  addEarthquakeEffect(lat, lon, magnitude, radius) {
    if (!this.leafletReady || !this.leafletMap) return;
    
    // Color based on magnitude
    let color = '#00ff00'; // Green for small
    if (magnitude > 4) color = '#ffff00'; // Yellow
    if (magnitude > 5) color = '#ff8800'; // Orange  
    if (magnitude > 6) color = '#ff0000'; // Red
    if (magnitude > 7) color = '#800080'; // Purple
    
    // Create earthquake zone
    const earthquakeZone = L.circle([lat, lon], {
      color: color,
      fillColor: color,
      fillOpacity: 0.2,
      radius: radius * 1000, // Convert km to meters
      weight: 3,
      dashArray: '5, 5'
    }).addTo(this.leafletMap);
    
    // Add popup
    earthquakeZone.bindPopup(`
      <div style="color: #e6eef8; font-family: Arial, sans-serif;">
        <h4 style="margin: 0 0 8px 0; color: #cfe6ff;">Earthquake</h4>
        <p style="margin: 4px 0;"><strong>Magnitude:</strong> M${magnitude.toFixed(1)}</p>
        <p style="margin: 4px 0;"><strong>Radius:</strong> ${radius.toFixed(1)} km</p>
        <p style="margin: 4px 0;"><strong>Intensity:</strong> ${this.getEarthquakeIntensity(magnitude)}</p>
      </div>
    `);
    
    this.earthquakeEffects.push(earthquakeZone);
  }

  // Generate tsunami effect
  generateTsunami(lat, lon, magnitude, earthquakeRadius) {
    if (!this.leafletReady || !this.leafletMap) return;
    
    // Tsunami radius is typically 10-50x the earthquake radius
    const tsunamiRadius = earthquakeRadius * (20 + Math.random() * 30);
    
    // Create tsunami zone
    const tsunamiZone = L.circle([lat, lon], {
      color: '#0066ff',
      fillColor: '#0066ff',
      fillOpacity: 0.15,
      radius: tsunamiRadius * 1000, // Convert km to meters
      weight: 2,
      dashArray: '15, 10'
    }).addTo(this.leafletMap);
    
    // Add popup
    tsunamiZone.bindPopup(`
      <div style="color: #e6eef8; font-family: Arial, sans-serif;">
        <h4 style="margin: 0 0 8px 0; color: #cfe6ff;">Tsunami</h4>
        <p style="margin: 4px 0;"><strong>Triggered by:</strong> M${magnitude.toFixed(1)} Earthquake</p>
        <p style="margin: 4px 0;"><strong>Radius:</strong> ${tsunamiRadius.toFixed(1)} km</p>
        <p style="margin: 4px 0;"><strong>Risk:</strong> ${this.getTsunamiRisk(magnitude)}</p>
      </div>
    `);
    
    this.earthquakeEffects.push(tsunamiZone);
  }

  // Check if impact location is in ocean
  isOceanImpact(lat, lon) {
    // Simple ocean detection (in real implementation, would use proper ocean data)
    // Most of Earth's surface is ocean, so use a simple probability
    return Math.random() > 0.3; // 70% chance of ocean impact
  }

  // Get earthquake intensity description
  getEarthquakeIntensity(magnitude) {
    if (magnitude < 3) return 'Weak';
    if (magnitude < 4) return 'Light';
    if (magnitude < 5) return 'Moderate';
    if (magnitude < 6) return 'Strong';
    if (magnitude < 7) return 'Major';
    if (magnitude < 8) return 'Great';
    return 'Catastrophic';
  }

  // Get tsunami risk level
  getTsunamiRisk(magnitude) {
    if (magnitude < 5) return 'Low';
    if (magnitude < 6) return 'Medium';
    if (magnitude < 7) return 'High';
    return 'Very High';
  }

  // Toggle map size
  toggleMapSize() {
    const mapUI = document.getElementById('mapUI');
    const toggleBtn = document.getElementById('toggleMapSize');
    
    this.mapExpanded = !this.mapExpanded;
    
    if (this.mapExpanded) {
      mapUI.classList.add('expanded');
      toggleBtn.textContent = 'Collapse';
    } else {
      mapUI.classList.remove('expanded');
      toggleBtn.textContent = 'Expand';
    }
    
    // Trigger map resize
    if (this.leafletReady && this.leafletMap) {
      setTimeout(() => {
        this.leafletMap.invalidateSize();
      }, 300);
    }
  }


  // Calculate drag force on meteor with wind effects
  calculateDragForce(meteor) {
    const altitude = meteor.mesh.position.length() * this.SCENE_SCALE - this.earthRadiusMeters;
    if (altitude < 0) return new THREE.Vector3(); // Below surface
    
    const density = this.getAtmosphericDensity(altitude);
    const velocity = meteor.physVelocity ? meteor.physVelocity.clone() : meteor.velocity.clone().multiplyScalar(this.SCENE_SCALE);
    const speed = velocity.length();
    
    if (speed < 1) return new THREE.Vector3(); // No drag for very slow objects
    
    const area = meteor.area || Math.PI * Math.pow(meteor.size / 2, 2);
    
    // Get wind force
    const windForce = this.getWindForce(altitude);
    
    // Calculate relative velocity (meteor velocity - wind velocity)
    const relativeVelocity = velocity.clone().sub(windForce);
    const relativeSpeed = relativeVelocity.length();
    
    if (relativeSpeed < 0.1) return new THREE.Vector3(); // No drag for very slow relative motion
    
    // Drag force based on relative velocity
    const dragForce = 0.5 * density * relativeSpeed * relativeSpeed * this.dragCoefficient * area;
    
    // Drag force opposes relative velocity direction
    const dragDirection = relativeVelocity.normalize().multiplyScalar(-1);
    
    return dragDirection.multiplyScalar(dragForce);
  }

  // Check if meteor should burn up
  shouldBurnUp(meteor) {
    const altitude = meteor.mesh.position.length() * this.SCENE_SCALE - this.earthRadiusMeters;
    if (altitude > this.atmosphereHeight) return false;
    
    const speed = meteor.physVelocity ? meteor.physVelocity.length() : meteor.velocity.length() * this.SCENE_SCALE;
    return speed > this.burnSpeedThreshold;
  }

  // Create randomized meteor geometry for more realistic appearance
  createRandomizedMeteor() {
    // Create irregular geometry using noise or random deformation
    const baseGeo = new THREE.SphereGeometry(1, 12, 8);
    const positions = baseGeo.attributes.position.array;
    
    // Add random noise to vertices for irregular shape
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      
      // Calculate distance from center
      const distance = Math.sqrt(x * x + y * y + z * z);
      
      // Add random noise based on distance from center
      const noise = (Math.random() - 0.5) * 0.3;
      const scale = 1 + noise * (1 - distance * 0.5); // More noise at edges
      
      positions[i] *= scale;
      positions[i + 1] *= scale;
      positions[i + 2] *= scale;
    }
    
    baseGeo.attributes.position.needsUpdate = true;
    baseGeo.computeVertexNormals();
    
    // Try to load meteor texture
    const meteorMat = new THREE.MeshStandardMaterial({ 
      color: 0x888888, 
      metalness: Math.random() * 0.2 + 0.05, 
      roughness: Math.random() * 0.4 + 0.4,
      bumpScale: Math.random() * 0.1 + 0.05
    });
    
    // Load meteor texture if available
    this.loadMeteorTexture(meteorMat);
    
    return new THREE.Mesh(baseGeo, meteorMat);
  }

  // Load meteor texture
  loadMeteorTexture(material) {
    const loader = new THREE.TextureLoader();
    loader.load('./meteor_texture.jpg', texture => {
      texture.encoding = THREE.sRGBEncoding;
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      material.map = texture;
      material.needsUpdate = true;
      console.log('Meteor texture loaded successfully');
    }, undefined, err => {
      console.debug('Meteor texture not found, using default material');
    });
  }

  // Get meteor density from NASA NEO API
  async getMeteorDensity(asteroidId) {
    try {
      const apiKey = document.getElementById('apiKey')?.value.trim();
      if (!apiKey) return 3000; // Default density in kg/m³
      
      const response = await fetch(`https://api.nasa.gov/neo/rest/v1/neo/${asteroidId}?api_key=${apiKey}`);
      const data = await response.json();
      
      // Extract density from NASA data if available
      if (data.orbital_data && data.orbital_data.density) {
        return parseFloat(data.orbital_data.density) * 1000; // Convert g/cm³ to kg/m³
      }
      
      // Estimate density based on asteroid type
      const spectralType = data.orbital_data?.spectral_type || 'Unknown';
      return this.estimateDensityFromType(spectralType);
      
    } catch (error) {
      console.warn('Could not fetch meteor density from NASA API:', error);
      return 3000; // Default density
    }
  }

  // Estimate density based on asteroid spectral type
  estimateDensityFromType(spectralType) {
    const densityMap = {
      'C': 2000,  // Carbonaceous - low density
      'S': 3000,  // Silicate - medium density  
      'M': 5000,  // Metallic - high density
      'P': 1500,  // Primitive - very low density
      'D': 1800,  // Dark - low density
      'T': 2500,  // Trojan - medium-low density
      'B': 2200,  // Blue - low-medium density
      'G': 2100,  // Gray - low-medium density
      'F': 2300,  // F-type - low-medium density
      'A': 4000,  // A-type - high density
      'E': 3500,  // Enstatite - medium-high density
      'R': 3200,  // R-type - medium density
      'V': 2800,  // Vesta-like - medium density
      'Unknown': 3000 // Default
    };
    
    return densityMap[spectralType] || 3000;
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

  // Create particle-based explosion effect
  createExplosion(position, energy, meteorSize = 1000) {
    if (!this.enableExplosions) return;
    
    // Add to impact map
    this.addImpactToMap(position, energy);
    
    // Log explosion data
    const kilotons = energy / 4.184e12;
    console.log(`Impact: ${kilotons.toFixed(2)} kt`);
    
    // Create particle explosion
    this.createParticleExplosion(position, energy, meteorSize);
  }

  // Create high-effort realistic explosion with multiple effects
  createParticleExplosion(position, energy, meteorSize = 1000) {
    // Calculate explosion parameters
    const kilotons = energy / 4.184e12;
    const meteorSizeFactor = Math.max(0.5, Math.min(3.0, Math.log10(meteorSize + 1) / 2));
    const baseRadius = Math.max(0.1, Math.min(2.0, Math.pow(kilotons, 0.3) * 0.5 * meteorSizeFactor));
    
    // Create explosion group
    const explosionGroup = new THREE.Group();
    explosionGroup.position.copy(position);
    this.scene.add(explosionGroup);
    
    // 1. Initial flash (very bright, short duration)
    this.createExplosionFlash(explosionGroup, baseRadius, energy);
    
    // 2. Fireball (main explosion)
    this.createFireball(explosionGroup, baseRadius, energy);
    
    // 3. Debris particles (high-velocity fragments)
    this.createDebrisParticles(explosionGroup, baseRadius, energy, meteorSize);
    
    // 4. Shockwave rings (atmospheric compression)
    this.createShockwaveRings(explosionGroup, baseRadius, energy);
    
    // 5. Mushroom cloud (for large explosions)
    if (kilotons > 1.0) {
      this.createMushroomCloud(explosionGroup, baseRadius, energy);
    }
    
    // 6. Atmospheric disturbance (affects atmosphere shader)
    this.createAtmosphericDisturbance(position, baseRadius, energy);
    
    // Add to particle systems for cleanup
    this.particleSystems.push({
      group: explosionGroup,
      startTime: Date.now(),
      duration: 8000, // 8 seconds for full effect (faster)
      position: position.clone(),
      energy: energy,
      type: 'high_effort'
    });
  }

  // Create initial explosion flash (faster, more intense)
  createExplosionFlash(parent, radius, energy) {
    const flashGeometry = new THREE.SphereGeometry(radius * 0.15, 16, 16);
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0
    });
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    parent.add(flash);
    
    // Animate flash (much faster)
    const startTime = Date.now();
    const animateFlash = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / 100); // 100ms duration (faster)
      
      if (progress < 1) {
        flash.material.opacity = 1.0 - progress * progress; // Quadratic fade for more dramatic effect
        flash.scale.setScalar(1 + progress * 8); // Faster expansion
        requestAnimationFrame(animateFlash);
      } else {
        parent.remove(flash);
      }
    };
    animateFlash();
  }

  // Create main fireball (faster, more dust/fire-like)
  createFireball(parent, radius, energy) {
    const fireballGeometry = new THREE.SphereGeometry(radius, 32, 32);
    const fireballMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 },
        radius: { value: radius },
        energy: { value: energy },
        color1: { value: new THREE.Color(0xff0000) },
        color2: { value: new THREE.Color(0xff4400) },
        color3: { value: new THREE.Color(0xff8800) },
        dustColor: { value: new THREE.Color(0x8B4513) }
      },
      vertexShader: `
        varying vec3 vPosition;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        void main() {
          vPosition = position;
          vNormal = normal;
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float radius;
        uniform float energy;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec3 dustColor;
        varying vec3 vPosition;
        varying vec3 vNormal;
        varying vec3 vWorldPosition;
        
        // Noise function for dust/fire turbulence
        float noise(vec3 p) {
          return sin(p.x * 15.0 + time * 8.0) * 0.1 +
                 sin(p.y * 12.0 + time * 6.0) * 0.1 +
                 sin(p.z * 18.0 + time * 7.0) * 0.1 +
                 sin(p.x * 25.0 + p.y * 20.0 + time * 10.0) * 0.05;
        }
        
        void main() {
          float dist = length(vPosition);
          float normalizedDist = dist / radius;
          
          // Create more chaotic dust/fire pattern
          float turbulence = noise(vPosition * 2.0) + noise(vPosition * 4.0) * 0.5;
          
          // Faster, more chaotic color changes
          float timeFactor = sin(time * 8.0) * 0.5 + 0.5;
          float dustFactor = sin(time * 12.0 + vPosition.x * 5.0) * 0.5 + 0.5;
          
          // Mix fire and dust colors
          vec3 fireColor = mix(color1, color2, normalizedDist + turbulence);
          fireColor = mix(fireColor, color3, timeFactor * 0.4);
          
          vec3 finalColor = mix(fireColor, dustColor, dustFactor * 0.3);
          
          // Faster fade with more dramatic falloff
          float opacity = (1.0 - normalizedDist) * (1.0 - time * 0.3) * 0.9;
          opacity = max(0.0, opacity);
          
          // Add some sparkle for dust particles
          float sparkle = sin(vPosition.x * 30.0 + time * 20.0) * 0.1 + 0.9;
          finalColor *= sparkle;
          
          gl_FragColor = vec4(finalColor, opacity);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide
    });
    
    const fireball = new THREE.Mesh(fireballGeometry, fireballMaterial);
    parent.add(fireball);
    
    // Animate fireball (much faster)
    const startTime = Date.now();
    const animateFireball = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / 1500); // 1.5 second duration (faster)
      
      if (progress < 1) {
        fireballMaterial.uniforms.time.value = elapsed * 0.002; // Faster animation
        fireball.scale.setScalar(1 + progress * 4); // Faster expansion
        fireball.material.opacity = (1.0 - progress * progress) * 0.9; // Quadratic fade
        requestAnimationFrame(animateFireball);
      } else {
        parent.remove(fireball);
      }
    };
    animateFireball();
  }

  // Create debris particles (faster, more dust/fire-like)
  createDebrisParticles(parent, radius, energy, meteorSize) {
    const particleCount = Math.min(1500, Math.max(300, energy / 1e12 * 150));
    const particles = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const lifetimes = new Float32Array(particleCount);
    const types = new Float32Array(particleCount); // 0 = dust, 1 = fire
    
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      
      // Random position around explosion center
      const angle = Math.random() * Math.PI * 2;
      const height = (Math.random() - 0.5) * radius * 2;
      const r = Math.random() * radius * 0.3;
      
      positions[i3] = Math.cos(angle) * r;
      positions[i3 + 1] = height;
      positions[i3 + 2] = Math.sin(angle) * r;
      
      // Much higher velocity for faster effect
      const speed = Math.random() * 4 + 2; // 2-6 speed (faster)
      const direction = new THREE.Vector3(
        Math.cos(angle) * speed,
        (Math.random() - 0.5) * 1.0, // More vertical spread
        Math.sin(angle) * speed
      );
      
      velocities[i3] = direction.x;
      velocities[i3 + 1] = direction.y;
      velocities[i3 + 2] = direction.z;
      
      // More dust and fire colors
      const colorVariation = Math.random();
      const particleType = Math.random();
      types[i] = particleType;
      
      if (particleType < 0.3) {
        // Fire particles
        if (colorVariation < 0.3) {
          colors[i3] = 1.0; colors[i3 + 1] = 0.3; colors[i3 + 2] = 0.0; // Bright red
        } else if (colorVariation < 0.6) {
          colors[i3] = 1.0; colors[i3 + 1] = 0.6; colors[i3 + 2] = 0.0; // Orange
        } else {
          colors[i3] = 1.0; colors[i3 + 1] = 1.0; colors[i3 + 2] = 0.0; // Yellow
        }
      } else {
        // Dust particles
        if (colorVariation < 0.4) {
          colors[i3] = 0.6; colors[i3 + 1] = 0.4; colors[i3 + 2] = 0.2; // Brown dust
        } else if (colorVariation < 0.7) {
          colors[i3] = 0.4; colors[i3 + 1] = 0.3; colors[i3 + 2] = 0.2; // Dark brown
        } else {
          colors[i3] = 0.3; colors[i3 + 1] = 0.3; colors[i3 + 2] = 0.3; // Gray dust
        }
      }
      
      sizes[i] = Math.random() * 0.15 + 0.03; // Slightly larger
      lifetimes[i] = Math.random() * 3 + 2; // 2-5 seconds (shorter)
    }
    
    particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particles.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    particles.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    particles.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    particles.setAttribute('lifetime', new THREE.BufferAttribute(lifetimes, 1));
    particles.setAttribute('type', new THREE.BufferAttribute(types, 1));
    
    const particleMaterial = new THREE.PointsMaterial({
      size: 0.12,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    
    const particleSystem = new THREE.Points(particles, particleMaterial);
    particleSystem.userData = {
      velocities: velocities,
      lifetimes: lifetimes,
      types: types,
      particleCount: particleCount,
      startTime: Date.now()
    };
    
    parent.add(particleSystem);
    
    // Animate particles (faster)
    const animateParticles = () => {
      const elapsed = (Date.now() - particleSystem.userData.startTime) * 0.001;
      const positions = particleSystem.geometry.attributes.position.array;
      const velocities = particleSystem.userData.velocities;
      const lifetimes = particleSystem.userData.lifetimes;
      const types = particleSystem.userData.types;
      
      let activeParticles = 0;
      for (let i = 0; i < particleSystem.userData.particleCount; i++) {
        const i3 = i * 3;
        lifetimes[i] -= 0.02; // Faster decay
        
        if (lifetimes[i] > 0) {
          activeParticles++;
          // Update positions with faster movement
          positions[i3] += velocities[i3] * 0.02;
          positions[i3 + 1] += velocities[i3 + 1] * 0.02;
          positions[i3 + 2] += velocities[i3 + 2] * 0.02;
          
          // Apply gravity (stronger for dust)
          if (types[i] > 0.3) { // Dust particles
            velocities[i3 + 1] -= 0.03;
          } else { // Fire particles
            velocities[i3 + 1] -= 0.01; // Less gravity for fire
          }
          
          // Add some turbulence
          velocities[i3] += (Math.random() - 0.5) * 0.01;
          velocities[i3 + 2] += (Math.random() - 0.5) * 0.01;
        }
      }
      
      if (activeParticles > 0) {
        particleSystem.geometry.attributes.position.needsUpdate = true;
        requestAnimationFrame(animateParticles);
      } else {
        parent.remove(particleSystem);
      }
    };
    animateParticles();
  }

  // Create shockwave rings (faster)
  createShockwaveRings(parent, radius, energy) {
    const ringCount = 4; // More rings
    const ringGeometry = new THREE.RingGeometry(radius * 0.3, radius * 1.2, 32);
    
    for (let i = 0; i < ringCount; i++) {
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0x8B00FF,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide
      });
      
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.userData = {
        startTime: Date.now() + i * 100, // Faster staggered timing
        duration: 1000 // Shorter duration
      };
      
      parent.add(ring);
      
      // Animate ring (faster)
      const animateRing = () => {
        const elapsed = Date.now() - ring.userData.startTime;
        const progress = Math.min(1, elapsed / ring.userData.duration);
        
        if (progress < 1) {
          ring.scale.setScalar(1 + progress * 6); // Faster expansion
          ring.material.opacity = 0.8 * (1 - progress * progress); // Quadratic fade
          requestAnimationFrame(animateRing);
        } else {
          parent.remove(ring);
        }
      };
      animateRing();
    }
  }

  // Create mushroom cloud for large explosions
  createMushroomCloud(parent, radius, energy) {
    const cloudGeometry = new THREE.SphereGeometry(radius * 2, 16, 16);
    const cloudMaterial = new THREE.MeshBasicMaterial({
      color: 0x666666,
      transparent: true,
      opacity: 0.4
    });
    
    const cloud = new THREE.Mesh(cloudGeometry, cloudMaterial);
    cloud.position.y = radius * 3;
    parent.add(cloud);
    
    // Animate mushroom cloud
    const startTime = Date.now();
    const animateCloud = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / 10000); // 10 second duration
      
      if (progress < 1) {
        cloud.scale.setScalar(1 + progress * 2);
        cloud.position.y = radius * 3 + progress * radius * 2;
        cloud.material.opacity = 0.4 * (1 - progress * 0.5);
        requestAnimationFrame(animateCloud);
      } else {
        parent.remove(cloud);
      }
    };
    animateCloud();
  }

  // Create atmospheric disturbance
  createAtmosphericDisturbance(position, radius, energy) {
    // This would affect the atmosphere shader uniforms
    // For now, we'll create a visual indicator
    const disturbanceGeometry = new THREE.SphereGeometry(radius * 3, 16, 16);
    const disturbanceMaterial = new THREE.MeshBasicMaterial({
      color: 0x444444,
      transparent: true,
      opacity: 0.1,
      wireframe: true
    });
    
    const disturbance = new THREE.Mesh(disturbanceGeometry, disturbanceMaterial);
    disturbance.position.copy(position);
    this.scene.add(disturbance);
    
    // Animate disturbance
    const startTime = Date.now();
    const animateDisturbance = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / 8000); // 8 second duration
      
      if (progress < 1) {
        disturbance.scale.setScalar(1 + progress * 3);
        disturbance.material.opacity = 0.1 * (1 - progress);
        requestAnimationFrame(animateDisturbance);
      } else {
        this.scene.remove(disturbance);
      }
    };
    animateDisturbance();
  }



  // Update Earth rotation
  updateEarthRotation() {
    const earth = this.scene.getObjectByName('earth');
    if (earth) {
      // Earth rotates once every 24 hours (86400 seconds)
      // Convert to scene time: 86400 seconds * simSpeed
      const rotationSpeed = (2 * Math.PI) / (86400 * this.simSpeed);
      earth.rotation.y += rotationSpeed * 0.02; // 0.02 is the frame time
    }
  }

  // Update shader uniforms with ray tracing data
  updateShaderUniforms() {
    const time = Date.now() * 0.001;
    const cameraPosition = this.camera.position.clone();
    const earthPosition = new THREE.Vector3(0, 0, 0);
    const earthRadius = 1.0;
    
    // Calculate sun position (directional light)
    const sunDirection = new THREE.Vector3(0, 0, 1);
    const lightPosition = sunDirection.clone().multiplyScalar(1000);
    
    // Update starfield
    if (this.starField && this.starField.material.uniforms) {
      this.starField.material.uniforms.time.value = time;
    }
    
    // Update atmosphere shader
    const atmosphere = this.scene.getObjectByName('atmosphere');
    if (atmosphere && atmosphere.material.uniforms) {
      atmosphere.material.uniforms.time.value = time;
      atmosphere.material.uniforms.cameraPosition.value.copy(cameraPosition);
      atmosphere.material.uniforms.earthPosition.value.copy(earthPosition);
      atmosphere.material.uniforms.earthRadius.value = earthRadius;
      atmosphere.material.uniforms.lightPosition.value.copy(lightPosition);
      atmosphere.material.uniforms.sunDirection.value.copy(sunDirection);
    }
    
    // Update meteor fire trails
    this.meteors.forEach(meteor => {
      if (meteor.fireTrail && meteor.fireTrail.material.uniforms) {
        meteor.fireTrail.material.uniforms.time.value = time;
        meteor.fireTrail.material.uniforms.cameraPosition.value.copy(cameraPosition);
        meteor.fireTrail.material.uniforms.earthPosition.value.copy(earthPosition);
        meteor.fireTrail.material.uniforms.earthRadius.value = earthRadius;
        meteor.fireTrail.material.uniforms.lightPosition.value.copy(lightPosition);
      }
    });
    
    // Update particle systems (particles.js handles its own updates)
    // No manual updates needed for particles.js
  }

  // Update particle systems
  updateParticleSystems() {
    // Clean up expired particle systems
    for (let i = this.particleSystems.length - 1; i >= 0; i--) {
      const system = this.particleSystems[i];
      const elapsed = Date.now() - system.startTime;
      
      if (elapsed >= system.duration) {
        // Remove expired particle system
        if (system.type === 'high_effort' && system.group) {
          this.scene.remove(system.group);
        } else if (system.container && system.container.parentNode) {
          system.container.parentNode.removeChild(system.container);
        }
        this.particleSystems.splice(i, 1);
      }
    }
  }

  // Toggle gravity visualizers
  toggleGravityVisualizers() {
    if (this.showGravityViz) {
      // Create gravity visualizers for Earth and Moon
      const earth = this.scene.getObjectByName('earth');
      if (earth) {
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
    
    // Create randomized meteor mesh
    const meteor = this.createRandomizedMeteor();
    
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
      if (r > 0.1) { // Avoid division by zero
        const gravityAccel = pos.clone().normalize().multiplyScalar(-this.gravityStrength / (r * r));
        vel.add(gravityAccel.multiplyScalar(dt));
      }
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
    const meteor = this.createRandomizedMeteor();
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
    const lon = -Math.atan2(z, x) * 180 / Math.PI; // Reverse longitude for correct mapping
    
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
    const objectCount = this.meteors.length + this.particleSystems.length + this.impactEffects.length + this.trajectoryLines.length;
    
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
    this.meteors.forEach(m=>{ 
      if(m.mesh) this.scene.remove(m.mesh); 
      if(m.fireTrail) this.scene.remove(m.fireTrail);
      if(m.label && m.label.element) m.label.element.remove(); 
    });
    this.meteors = [];
    this.impactEffects.forEach(e=>{ if(e.mesh) this.scene.remove(e.mesh); });
    this.impactEffects = [];
    this.particleSystems.forEach(ps=>{ 
      if(ps.type === 'high_effort' && ps.group) {
        this.scene.remove(ps.group);
      } else if(ps.container && ps.container.parentNode) {
        ps.container.parentNode.removeChild(ps.container);
      }
    });
    this.particleSystems = [];
    this.gravityVisualizers.forEach(v=>{ this.scene.remove(v.mesh); });
    this.gravityVisualizers = [];
    this.trajectoryLines.forEach(t=>{ this.scene.remove(t.line); });
    this.trajectoryLines = [];
    
    // Clear Leaflet markers and circles
    this.mapMarkers.forEach(marker => {
      if (marker.remove) {
        marker.remove();
      }
    });
    this.mapCircles.forEach(circle => {
      if (circle.remove) {
        circle.remove();
      }
    });
    this.mapMarkers = [];
    this.mapCircles = [];
    
    // Clear earthquake effects
    this.earthquakeEffects.forEach(effect => {
      if (effect.remove) {
        effect.remove();
      }
    });
    this.earthquakeEffects = [];
    
    // Clear orbital objects
    this.orbitalObjects.forEach(orbitalObject => {
      this.scene.remove(orbitalObject.mesh);
      this.scene.remove(orbitalObject.trail);
    });
    this.orbitalObjects = [];
    
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
      // Use effect composer for post-processing
      if (this.effectComposer) {
        this.effectComposer.render();
      } else {
      // Use standard rendering for now
      this.renderer.render(this.scene, this.camera);
      }
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

    // update Earth rotation
    this.updateEarthRotation();

    // update camera focus
    this.updateCameraFocus();

    // update gravity visualizers
    this.updateGravityVisualizers();

    // update particle systems
    this.updateParticleSystems();

    // update shader uniforms
    this.updateShaderUniforms();

    // update orbital objects
    this.orbitalObjects.forEach(orbitalObject => {
      this.propagateOrbit(orbitalObject, 0.02 * this.simSpeed);
    });

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
          meteor.burnIntensity = 0;
          this.createBurnEffect(meteor);
          this.createFireTrail(meteor);
        }
        
        // Update fire trail
        this.updateFireTrail(meteor);
        
        meteor.burnIntensity = Math.min(1, meteor.burnIntensity + 0.05 * this.simSpeed);
        
        // Enhanced burning effects with terminal velocity consideration
        const terminalVelocity = this.calculateTerminalVelocity(meteor, altitude);
        const currentSpeed = meteor.physVelocity ? meteor.physVelocity.length() : meteor.velocity.length() * this.SCENE_SCALE;
        
        // More intense burning if significantly above terminal velocity
        const speedRatio = currentSpeed / terminalVelocity;
        const burnRate = Math.min(1, speedRatio * 0.1 * this.simSpeed);
        
        // Random chance of complete burn-up based on burn intensity and speed
        if(Math.random() < meteor.burnIntensity * burnRate) {
          meteor.active = false;
          this.scene.remove(meteor.mesh);
          if(meteor.fireTrail) {
            this.scene.remove(meteor.fireTrail);
          }
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
        let earthGravityForce;
        if (rmag > 0.1) { // Avoid division by zero
          earthGravityForce = posMeters.clone().multiplyScalar(-this.G*this.earthMass/(rmag*rmag*rmag));
        } else {
          earthGravityForce = new THREE.Vector3(0, 0, 0);
        }
        
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
        
        // Calculate mass reduction due to atmospheric ablation
        const massLoss = this.calculateMassReduction(meteor, dt);
        
        // Apply forces (F = ma, so a = F/m)
        const totalForce = earthGravityForce.add(moonGravityForce).add(meteorGravityForce).add(dragForce);
        const acceleration = totalForce.divideScalar(meteor.mass);
        
        meteor.physVelocity.add(acceleration.multiplyScalar(dt));
        posMeters.add(meteor.physVelocity.clone().multiplyScalar(dt));
        meteor.mesh.position.copy(posMeters.multiplyScalar(1/this.SCENE_SCALE));
        if(meteor.label) meteor.label.position.copy(meteor.mesh.position);
      } else {
        // Enhanced simple mode physics with proper gravity
        let gravityAccel;
        if (r > 0.1) { // Avoid division by zero
          gravityAccel = pos.clone().normalize().multiplyScalar(-this.gravityStrength/(r*r));
        } else {
          gravityAccel = new THREE.Vector3(0, 0, 0);
        }
        
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
          const dragAccel = meteor.velocity.clone().normalize().multiplyScalar(-0.002 * this.simSpeed);
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
          this.createExplosion(pos.clone(), ke, meteor.size);
          
          const keTons = ke / 4.184e9;
          const blastRadius = this.calculateBlastRadius(ke);
          const ie = document.getElementById('impactEnergy'); if(ie) ie.innerText = `${ke.toExponential(3)} J (~${keTons.toFixed(2)} kt)`;
          
          // Add to Leaflet map
          const latLon = this.positionToLatLon(pos);
          this.addImpactToLeafletMap(latLon.lat, latLon.lon, ke, blastRadius);
          
          // Calculate earthquake effects
          this.calculateEarthquakeEffects(latLon.lat, latLon.lon, ke);
          
          // Update map info
          const blastRadiusEl = document.getElementById('blastRadius');
          if (blastRadiusEl) blastRadiusEl.textContent = blastRadius.toFixed(1);
          
          // Update statistics
          this.totalImpactEnergy += ke;
          this.largestImpactEnergy = Math.max(this.largestImpactEnergy, ke);
          this.impactCount++;
        }catch(e){ console.error('impact energy calc', e); const ie = document.getElementById('impactEnergy'); if(ie) ie.innerText = '-'; }
        
        this.scene.remove(meteor.mesh);
        if(meteor.fireTrail) {
          this.scene.remove(meteor.fireTrail);
        }
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
      // Use standard rendering for now
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
      if (r > 0.1) { // Avoid division by zero
        const accel = pos.clone().normalize().multiplyScalar(-this.gravityStrength/(r*r));
        v.add(accel.multiplyScalar(dt));
      }
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
    if(!apiKey) return showEnhancedAlert('API Key Required', 'Please enter your NASA API key to fetch asteroid data.', 'warning');
    if(!loadMore) { this.neoPage = 0; this.asteroidList = []; document.getElementById('asteroidSelect').innerHTML = ''; }
    try{
      const res = await fetch(`https://api.nasa.gov/neo/rest/v1/neo/browse?page=${this.neoPage||0}&size=20&api_key=${apiKey}`);
      const data = await res.json();
      const select = document.getElementById('asteroidSelect');
      data.near_earth_objects.forEach(a=>{
        this.asteroidList = this.asteroidList || [];
        this.asteroidList.push(a);
      });
      
      // Sort asteroids by average diameter (largest first) and update dropdown
      if (!loadMore) {
        this.asteroidList.sort((a, b) => {
          const avgA = (a.estimated_diameter.meters.estimated_diameter_min + a.estimated_diameter.meters.estimated_diameter_max) / 2;
          const avgB = (b.estimated_diameter.meters.estimated_diameter_min + b.estimated_diameter.meters.estimated_diameter_max) / 2;
          return avgB - avgA;
        });
        
        // Clear and repopulate dropdown with sorted list
        select.innerHTML = '<option value="">Select an asteroid...</option>';
        this.asteroidList.forEach(a => {
          const minSize = a.estimated_diameter.meters.estimated_diameter_min;
          const maxSize = a.estimated_diameter.meters.estimated_diameter_max;
          const midSize = (minSize + maxSize) / 2;
          
          const option = document.createElement('option'); 
          option.value = a.id; 
          option.textContent = `${a.name} (${midSize.toFixed(0)}m avg)`; 
          select.appendChild(option);
        });
      } else {
        // For load more, just add new options
        data.near_earth_objects.forEach(a=>{
          const minSize = a.estimated_diameter.meters.estimated_diameter_min;
          const maxSize = a.estimated_diameter.meters.estimated_diameter_max;
          const midSize = (minSize + maxSize) / 2;
          
          const option = document.createElement('option'); 
          option.value = a.id; 
          option.textContent = `${a.name} (${midSize.toFixed(0)}m avg)`; 
          select.appendChild(option);
        });
      }
      this.neoPage = (this.neoPage||0) + 1;
      document.getElementById('asteroidData').innerHTML = `Fetched ${this.asteroidList.length} asteroids (page ${this.neoPage})`;
    }catch(err){ console.error(err); showEnhancedAlert('Error', 'Failed to fetch asteroid data. Please check your API key and try again.', 'error'); }
  }

  async fetchAsteroidDetails(id){
    const apiKey = document.getElementById('apiKey')?.value.trim(); if(!apiKey) return null;
    try{ const res = await fetch(`https://api.nasa.gov/neo/rest/v1/neo/${id}?api_key=${apiKey}`); return await res.json(); }catch(err){ console.error(err); return null; }
  }

  async selectAsteroid(){
    const select = document.getElementById('asteroidSelect'); 
    if(!select.value) return alert('Select an asteroid');
    
    const details = await this.fetchAsteroidDetails(select.value) || (this.asteroidList||[]).find(a=>a.id===select.value);
    if(!details) return alert('Could not fetch asteroid details');
    
    // Calculate estimated impact energy with real density
    const avgDiameter = (details.estimated_diameter.meters.estimated_diameter_min + details.estimated_diameter.meters.estimated_diameter_max) / 2;
    const density = await this.getMeteorDensity(details.id);
    const mass = (4/3) * Math.PI * Math.pow(avgDiameter / 2, 3) * density;
    const velocity = parseFloat(details.close_approach_data[0].relative_velocity.kilometers_per_second) * 1000; // Convert to m/s
    const kineticEnergy = 0.5 * mass * velocity * velocity;
    const kilotons = kineticEnergy / 4.184e12;
    const blastRadius = this.calculateBlastRadius(kineticEnergy);
    
    // Update UI with detailed information
    document.getElementById('asteroidData').innerHTML = `
      <b>${details.name}</b><br>
      Min Diameter: ${details.estimated_diameter.meters.estimated_diameter_min.toFixed(1)} m<br>
      Max Diameter: ${details.estimated_diameter.meters.estimated_diameter_max.toFixed(1)} m<br>
      <b>Mid Diameter: ${avgDiameter.toFixed(1)} m</b><br>
      Miss distance: ${parseFloat(details.close_approach_data[0].miss_distance.kilometers).toFixed(0)} km<br>
      Velocity: ${parseFloat(details.close_approach_data[0].relative_velocity.kilometers_per_second).toFixed(1)} km/s<br>
      <b>Density: ${density.toFixed(0)} kg/m³</b><br>
      Mass: ${(mass/1000).toFixed(1)} tons<br>
      <hr style="margin: 8px 0; border: 1px solid #444;">
      <b>Estimated Impact Energy: ${kilotons.toFixed(2)} kt</b><br>
      <b>Estimated Blast Radius: ${blastRadius.toFixed(1)} km</b><br>
      <b>Threat Level: ${this.getThreatLevel(kilotons)}</b>
    `;
    
    console.log('Asteroid selected:', details.name);
  }

  // Get threat level based on energy
  getThreatLevel(kilotons) {
    if (kilotons < 0.1) return 'Minimal';
    if (kilotons < 1) return 'Low';
    if (kilotons < 10) return 'Moderate';
    if (kilotons < 100) return 'High';
    if (kilotons < 1000) return 'Extreme';
    return 'Catastrophic';
  }

  // Create random orbital object
  createRandomOrbit() {
    const orbitalParams = {
      semiMajorAxis: 500000 + Math.random() * 2000000, // 500km to 2.5Mm
      eccentricity: Math.random() * 0.8, // 0 to 0.8
      inclination: Math.random() * Math.PI, // 0 to 180 degrees
      longitudeOfAscendingNode: Math.random() * 2 * Math.PI,
      argumentOfPeriapsis: Math.random() * 2 * Math.PI,
      meanAnomaly: Math.random() * 2 * Math.PI,
      period: 1800 + Math.random() * 7200, // 30 minutes to 2 hours
      color: new THREE.Color().setHSL(Math.random(), 0.8, 0.6).getHex(),
      size: 500 + Math.random() * 1500 // 500m to 2km
    };
    
    const orbitalObject = this.createOrbitalObject(orbitalParams);
    console.log('Created orbital object with params:', orbitalParams);
    
    return orbitalObject;
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
    
    // Create randomized meteor mesh
    const meteor = this.createRandomizedMeteor();
    
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
        const earth = this.scene.getObjectByName('earth');
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

  onWindowResize(){ 
    if(!this.camera||!this.renderer) return; 
    this.camera.aspect = window.innerWidth/window.innerHeight; 
    this.camera.updateProjectionMatrix(); 
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    
    // Update effect composer size if it exists
    if (this.effectComposer) {
      this.effectComposer.setSize(window.innerWidth, window.innerHeight);
    }
    
    // Update DOF pass if it exists
    if (this.dofPass) {
      this.dofPass.uniforms.aspect.value = this.camera.aspect;
      this.dofPass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
    }
  }
}

const app = new App();
app.init();
app.animate();

// expose for debugging
window.app = app;
