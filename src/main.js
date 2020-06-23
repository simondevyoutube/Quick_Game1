import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js';
import {ColladaLoader} from 'https://cdn.jsdelivr.net/npm/three@0.112.1/examples/jsm/loaders/ColladaLoader.js';
import {FBXLoader} from 'https://cdn.jsdelivr.net/npm/three@0.112.1/examples/jsm/loaders/FBXLoader.js';
import {GLTFLoader} from 'https://cdn.jsdelivr.net/npm/three@0.112.1/examples/jsm/loaders/GLTFLoader.js';
import {GUI} from 'https://cdn.jsdelivr.net/npm/three@0.112.1/examples/jsm/libs/dat.gui.module.js';
import {BufferGeometryUtils} from 'https://cdn.jsdelivr.net/npm/three@0.112.1/examples/jsm/utils/BufferGeometryUtils.js';

import {agent} from './agent.js';
import {controls} from './controls.js';
import {game} from './game.js';
import {math} from './math.js';
import {terrain} from './terrain.js';
import {visibility} from './visibility.js';

import {particles} from './particles.js';
import {blaster} from './blaster.js';


let _APP = null;

const _NUM_BOIDS = 100;
const _BOID_SPEED = 100;
const _BOID_ACCELERATION = _BOID_SPEED / 2.5;
const _BOID_FORCE_MAX = _BOID_ACCELERATION / 20.0;
const _BOID_FORCE_ORIGIN = 50;
const _BOID_FORCE_ALIGNMENT = 10;
const _BOID_FORCE_SEPARATION = 20;
const _BOID_FORCE_COLLISION = 50;
const _BOID_FORCE_COHESION = 5;
const _BOID_FORCE_WANDER = 3;


class PlayerEntity {
  constructor(params) {
    this._model = params.model;
    this._params = params;
    this._game = params.game;
    this._fireCooldown = 0.0;
    this._velocity = new THREE.Vector3(0, 0, 0);
    this._direction = new THREE.Vector3(0, 0, -1);
    this._health = 1000.0;

    const x = 2.75;
    const y1 = 1.5;
    const y2 = 0.4;
    const z = 4.0;
    this._offsets = [
        new THREE.Vector3(-x, y1, -z),
        new THREE.Vector3(x, y1, -z),
        new THREE.Vector3(-x, -y2, -z),
        new THREE.Vector3(x, -y2, -z),
    ];

    this._offsetIndex = 0;

    this._visibilityIndex = this._game._visibilityGrid.UpdateItem(
        this._model.uuid, this);
  }

  get Enemy() {
    return false;
  }

  get Velocity() {
    return this._velocity;
  }

  get Direction() {
    return this._direction;
  }

  get Position() {
    return this._model.position;
  }

  get Radius() {
    return 1.0;
  }

  get Health() {
    return this._health;
  }

  get Dead() {
    return (this._health <= 0.0);
  }

  TakeDamage(dmg) {
    this._params.game._entities['_explosionSystem'].Splode(this.Position);

    this._health -= dmg;
    if (this._health <= 0.0) {
      this._game._visibilityGrid.RemoveItem(this._model.uuid, this._game._visibilityIndex);
    }    
  }

  Fire() {
    if (this._fireCooldown > 0.0) {
      return;
    }

    this._fireCooldown = 0.05;

    const p = this._params.game._entities['_blasterSystem'].CreateParticle();
    p.Start = this._offsets[this._offsetIndex].clone();
    p.Start.applyQuaternion(this._model.quaternion);
    p.Start.add(this.Position);
    p.End = p.Start.clone();
    p.Velocity = this.Direction.clone().multiplyScalar(500.0);
    p.Length = 50.0;
    p.Colours = [
        new THREE.Color(4.0, 0.5, 0.5), new THREE.Color(0.0, 0.0, 0.0)];
    p.Life = 2.0;
    p.TotalLife = 2.0;
    p.Width = 0.25;

    this._offsetIndex = (this._offsetIndex + 1) % this._offsets.length;
  }

  Update(timeInSeconds) {
    if (this.Dead) {
      return;
    }

    this._visibilityIndex = this._game._visibilityGrid.UpdateItem(
        this._model.uuid, this, this._visibilityIndex);
    this._fireCooldown -= timeInSeconds;
    this._burstCooldown = Math.max(this._burstCooldown, 0.0);
    this._direction.copy(this._velocity);
    this._direction.normalize();
    this._direction.applyQuaternion(this._model.quaternion);
  }
}


class ExplodeParticles {
  constructor(game) {
    this._particleSystem = new particles.ParticleSystem(
        game, {texture: "./resources/explosion.png"});
    this._particles = [];
  }

  Splode(origin) {
    for (let i = 0; i < 96; i++) {
      const p = this._particleSystem.CreateParticle();
      p.Position.copy(origin);
      p.Velocity = new THREE.Vector3(
          math.rand_range(-1, 1),
          math.rand_range(-1, 1),
          math.rand_range(-1, 1)
      );
      p.Velocity.normalize();
      p.Velocity.multiplyScalar(50);
      p.TotalLife = 2.0;
      p.Life = p.TotalLife;
      p.Colours = [new THREE.Color(0xFF8010), new THREE.Color(0xFF8010)];
      p.Sizes = [4, 16];
      p.Size = p.Sizes[0];
      this._particles.push(p);
    }
  }

  Update(timeInSeconds) {
    const _V = new THREE.Vector3();

    this._particles = this._particles.filter(p => {
      return p.Alive;
    });
    for (const p of this._particles) {
      p.Life -= timeInSeconds;
      if (p.Life <= 0) {
        p.Alive = false;
      }
      p.Position.add(p.Velocity.clone().multiplyScalar(timeInSeconds));

      _V.copy(p.Velocity);
      _V.multiplyScalar(10.0 * timeInSeconds);
      const velocityLength = p.Velocity.length();

      if (_V.length() > velocityLength) {
        _V.normalize();
        _V.multiplyScalar(velocityLength)
      }

      p.Velocity.sub(_V);
      p.Size = math.lerp(p.Life / p.TotalLife, p.Sizes[0], p.Sizes[1]);
      p.Colour.copy(p.Colours[0]);
      p.Colour.lerp(p.Colours[1], 1.0 - p.Life / p.TotalLife);
      p.Opacity = math.smootherstep(p.Life / p.TotalLife, 0.0, 1.0);
    }
    this._particleSystem.Update();
  }
};


class ProceduralTerrain_Demo extends game.Game {
  constructor() {
    super();
  }

  _OnInitialize() {
    this._CreateGUI();

    this._userCamera = new THREE.Object3D();
    this._userCamera.position.set(4100, 0, 0);

    this._graphics.Camera.position.set(10340, 880, -2130);
    this._graphics.Camera.quaternion.set(-0.032, 0.885, 0.062, 0.46);

    this._score = 0;

    // This is 2D but eh, whatever.
    this._visibilityGrid = new visibility.VisibilityGrid(
      [new THREE.Vector3(-10000, 0, -10000), new THREE.Vector3(10000, 0, 10000)],
      [100, 100]);

    this._entities['_explosionSystem'] = new ExplodeParticles(this);
    this._entities['_blasterSystem'] = new blaster.BlasterSystem(
        {
            game: this,
            texture: "./resources/blaster.jpg",
            visibility: this._visibilityGrid,
        });

    this._entities['_terrain'] = new terrain.TerrainChunkManager({
      camera: this._graphics.Camera,
      scene: this._graphics.Scene,
      gui: this._gui,
      guiParams: this._guiParams,
      game: this
    });

    this._library = {};

    let loader = new GLTFLoader();
    loader.setPath('./resources/models/x-wing/');
    loader.load('scene.gltf', (gltf) => {
      const model = gltf.scene.children[0];
      model.scale.setScalar(0.5);

      const group = new THREE.Group();
      group.add(model);

      this._graphics.Scene.add(group);

      this._entities['player'] = new PlayerEntity(
          {model: group, camera: this._graphics.Camera, game: this});

      this._entities['_controls'] = new controls.ShipControls({
        target: this._entities['player'],
        camera: this._graphics.Camera,
        scene: this._graphics.Scene,
        domElement: this._graphics._threejs.domElement,
        gui: this._gui,
        guiParams: this._guiParams,
      });
    });

    loader = new GLTFLoader();
    loader.setPath('./resources/models/tie-fighter-gltf/');
    loader.load('scene.gltf', (obj) => {
      // This is bad, but I only want the mesh and I know this only has 1.
      // This is what you get when you don't have an art pipeline and don't feel like making one.
      obj.scene.traverse((c) => {
        if (c.isMesh) {
          const model = obj.scene.children[0];
          model.scale.setScalar(0.05);
          model.rotateX(Math.PI);

          const mat = new THREE.MeshStandardMaterial({
            map: new THREE.TextureLoader().load(
                './resources/models/tie-fighter-gltf/textures/hullblue_baseColor.png'),
            normalMap: new THREE.TextureLoader().load(
                './resources/models/tie-fighter-gltf/textures/hullblue_normal.png'),
          });

          model.material = mat;

          this._library['tie-fighter'] = model;
        }

        if (this._library['tie-fighter']) {
          this._CreateEnemyShips();
        }
      });
    });

    this._LoadBackground();
  }

  _CreateEnemyShips() {
    const positions = [
      new THREE.Vector3(8000, 0, 0),
      new THREE.Vector3(-7000, 50, -100),
    ];
    const colours = [
      new THREE.Color(4.0, 0.5, 0.5),
      new THREE.Color(0.5, 0.5, 4.0),
    ];

    for (let j = 0; j < 2; j++) {
      const p = positions[j];

      let loader = new GLTFLoader();
      loader.setPath('./resources/models/star-destroyer/');
      loader.load('scene.gltf', (gltf) => {
        const model = gltf.scene.children[0];
        model.scale.setScalar(20.0);
        model.rotateZ(Math.PI / 2.0);

        const cruiser = model;
        cruiser.position.set(p.x, p.y, p.z);
        cruiser.castShadow = true;
        cruiser.receiveShadow = true;
        cruiser.updateWorldMatrix();
        this._graphics.Scene.add(cruiser);  
      });

      for (let i = 0; i < _NUM_BOIDS; i++) {
        let params = {
          mesh: this._library['tie-fighter'].clone(),
          speedMin: 1.0,
          speedMax: 1.0,
          speed: _BOID_SPEED,
          maxSteeringForce: _BOID_FORCE_MAX,
          acceleration: _BOID_ACCELERATION,
          seekGoal: p,
          colour: colours[j],
        };
    
        const e = new agent.Agent(this, params);
        this._entities['_boid_' + i] = e;
      }
      break;
    }
  }

  EnemyDied() {
    this._score++;
    document.getElementById('scoreText').innerText = this._score;
  }

  _CreateGUI() {
    this._CreateGameGUI();
    this._CreateControlGUI();
  }

  _CreateGameGUI() {
    const guiDiv = document.createElement('div');
    guiDiv.className = 'guiRoot guiBox';

    const scoreDiv = document.createElement('div');
    scoreDiv.className = 'vertical';

    const scoreTitle = document.createElement('div');
    scoreTitle.className = 'guiBigText';
    scoreTitle.innerText = 'KILLS';

    const scoreText = document.createElement('div');
    scoreText.className = 'guiSmallText';
    scoreText.innerText = '0';
    scoreText.id = 'scoreText';

    scoreDiv.appendChild(scoreTitle);
    scoreDiv.appendChild(scoreText);

    guiDiv.appendChild(scoreDiv);
    document.body.appendChild(guiDiv);
  }

  _CreateControlGUI() {
    this._guiParams = {
      general: {
      },
    };
    this._gui = new GUI();
    this._gui.hide();

    const generalRollup = this._gui.addFolder('General');
    this._gui.close();
  }

  _LoadBackground() {
    this._graphics.Scene.background = new THREE.Color(0xFFFFFF);
    const loader = new THREE.CubeTextureLoader();
    const texture = loader.load([
        './resources/space-posx.jpg',
        './resources/space-negx.jpg',
        './resources/space-posy.jpg',
        './resources/space-negy.jpg',
        './resources/space-posz.jpg',
        './resources/space-negz.jpg',
    ]);
    this._graphics._scene.background = texture;
  }

  _OnStep(timeInSeconds) {
  }
}


function _Main() {
  _APP = new ProceduralTerrain_Demo();
}

_Main();
