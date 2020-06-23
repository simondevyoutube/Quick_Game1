import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js';

import {graphics} from './graphics.js';
import {math} from './math.js';
import {noise} from './noise.js';
import {quadtree} from './quadtree.js';
import {spline} from './spline.js';
import {terrain_chunk} from './terrain-chunk.js';
import {terrain_shader} from './terrain-shader.js';
import {textures} from './textures.js';
import {utils} from './utils.js';

export const terrain = (function() {

  const _WHITE = new THREE.Color(0x808080);

  const _DEEP_OCEAN = new THREE.Color(0x20020FF);
  const _SHALLOW_OCEAN = new THREE.Color(0x8080FF);
  const _BEACH = new THREE.Color(0xd9d592);
  const _SNOW = new THREE.Color(0xFFFFFF);
  const _ApplyWeightsOREST_TROPICAL = new THREE.Color(0x4f9f0f);
  const _ApplyWeightsOREST_TEMPERATE = new THREE.Color(0x2b960e);
  const _ApplyWeightsOREST_BOREAL = new THREE.Color(0x29c100);
  
  const _GREEN = new THREE.Color(0x80FF80);
  const _RED = new THREE.Color(0xFF8080);
  const _BLACK = new THREE.Color(0x000000);
  
  const _MIN_CELL_SIZE = 500;
  const _MIN_CELL_RESOLUTION = 96;
  const _PLANET_RADIUS = 4000;


  class HeightGenerator {
    constructor(generator, position, minRadius, maxRadius) {
      this._position = position.clone();
      this._radius = [minRadius, maxRadius];
      this._generator = generator;
    }
  
    Get(x, y, z) {
      return [this._generator.Get(x, y, z), 1];
    }
  }
  
  
  class FixedHeightGenerator {
    constructor() {}
  
    Get() {
      return [50, 1];
    }
  }
   

  class TextureSplatter {
    constructor(params) {
      const _colourLerp = (t, p0, p1) => {
        const c = p0.clone();
  
        return c.lerp(p1, t);
      };
      this._colourSpline = [
        new spline.LinearSpline(_colourLerp),
        new spline.LinearSpline(_colourLerp)
      ];

      // Arid
      this._colourSpline[0].AddPoint(0.0, new THREE.Color(0xb7a67d));
      this._colourSpline[0].AddPoint(0.5, new THREE.Color(0xf1e1bc));
      this._colourSpline[0].AddPoint(1.0, _SNOW);
  
      // Humid
      this._colourSpline[1].AddPoint(0.0, _ApplyWeightsOREST_BOREAL);
      this._colourSpline[1].AddPoint(0.5, new THREE.Color(0xcee59c));
      this._colourSpline[1].AddPoint(1.0, _SNOW);

      this._oceanSpline = new spline.LinearSpline(_colourLerp);
      this._oceanSpline.AddPoint(0, _DEEP_OCEAN);
      this._oceanSpline.AddPoint(0.03, _SHALLOW_OCEAN);
      this._oceanSpline.AddPoint(0.05, _SHALLOW_OCEAN);

      this._params = params;
    }
  
    _BaseColour(x, y, z) {
      const m = this._params.biomeGenerator.Get(x, y, z);
      const h = math.sat(z / 100.0);
  
      const c1 = this._colourSpline[0].Get(h);
      const c2 = this._colourSpline[1].Get(h);
  
      let c = c1.lerp(c2, m);

      if (h < 0.1) {
        c = c.lerp(new THREE.Color(0x54380e), 1.0 - math.sat(h / 0.05));
      }
      return c;      
    }

    _Colour(x, y, z) {
      const c = this._BaseColour(x, y, z);
      const r = this._params.colourNoise.Get(x, y, z) * 2.0 - 1.0;

      c.offsetHSL(0.0, 0.0, r * 0.01);
      return c;
    }

    _GetTextureWeights(p, n, up) {
      const m = this._params.biomeGenerator.Get(p.x, p.y, p.z);
      const h = p.z / (100.0 * 0.25);

      const types = {
        dirt: {index: 0, strength: 0.0},
        grass: {index: 1, strength: 0.0},
        gravel: {index: 2, strength: 0.0},
        rock: {index: 3, strength: 0.0},
        snow: {index: 4, strength: 0.0},
        snowrock: {index: 5, strength: 0.0},
        cobble: {index: 6, strength: 0.0},
        sandyrock: {index: 7, strength: 0.0},
      };

      function _ApplyWeights(dst, v, m) {
        for (let k in types) {
          types[k].strength *= m;
        }
        types[dst].strength = v;
      };

      types.grass.strength = 1.0;
      _ApplyWeights('gravel', 1.0 - m, m);

      if (h < 0.2) {
        const s = 1.0 - math.sat((h - 0.1) / 0.05);
        _ApplyWeights('cobble', s, 1.0 - s);

        if (h < 0.1) {
          const s = 1.0 - math.sat((h - 0.05) / 0.05);
          _ApplyWeights('sandyrock', s, 1.0 - s);
        }
      } else {
        if (h > 0.125) {
          const s = (math.sat((h - 0.125) / 1.25));
          _ApplyWeights('rock', s, 1.0 - s);
        }

        if (h > 1.5) {
          const s = math.sat((h - 0.75) / 2.0);
          _ApplyWeights('snow', s, 1.0 - s);
        }
      }

      // In case nothing gets set.
      types.dirt.strength = 0.01;

      let total = 0.0;
      for (let k in types) {
        total += types[k].strength;
      }
      if (total < 0.01) {
        const a = 0;
      }
      const normalization = 1.0 / total;

      for (let k in types) {
        types[k].strength / normalization;
      }

      return types;
    }

    GetColour(position) {
      return this._Colour(position.x, position.y, position.z);
    }

    GetSplat(position, normal, up) {
      return this._GetTextureWeights(position, normal, up);
    }
  }

  
  class FixedColourGenerator {
    constructor(params) {
      this._params = params;
    }
  
    Get() {
      return this._params.colour;
    }
  }
  
  

  class TerrainChunkRebuilder {
    constructor(params) {
      this._pool = {};
      this._params = params;
      this._Reset();
    }

    AllocateChunk(params) {
      const w = params.width;

      if (!(w in this._pool)) {
        this._pool[w] = [];
      }

      let c = null;
      if (this._pool[w].length > 0) {
        c = this._pool[w].pop();
        c._params = params;
      } else {
        c = new terrain_chunk.TerrainChunk(params);
      }

      c.Hide();

      this._queued.push(c);

      return c;    
    }

    _RecycleChunks(chunks) {
      for (let c of chunks) {
        if (!(c.chunk._params.width in this._pool)) {
          this._pool[c.chunk._params.width] = [];
        }

        c.chunk.Destroy();
      }
    }

    _Reset() {
      this._active = null;
      this._queued = [];
      this._old = [];
      this._new = [];
    }

    get Busy() {
      return this._active || this._queued.length > 0;
    }

    Rebuild(chunks) {
      if (this.Busy) {
        return;
      }
      for (let k in chunks) {
        this._queued.push(chunks[k].chunk);
      }
    }

    Update() {
      if (this._active) {
        const r = this._active.next();
        if (r.done) {
          this._active = null;
        }
      } else {
        const b = this._queued.pop();
        if (b) {
          this._active = b._Rebuild();
          this._new.push(b);
        }
      }

      if (this._active) {
        return;
      }

      if (!this._queued.length) {
        this._RecycleChunks(this._old);
        for (let b of this._new) {
          b.Show();
        }
        this._Reset();
      }
    }
  }

  class TerrainChunkManager {
    constructor(params) {
      this._Init(params);
    }

    _Init(params) {
      this._params = params;

      const loader = new THREE.TextureLoader();

      const noiseTexture = loader.load('./resources/simplex-noise.png');
      noiseTexture.wrapS = THREE.RepeatWrapping;
      noiseTexture.wrapT = THREE.RepeatWrapping;

      const diffuse = new textures.TextureAtlas(params);
      diffuse.Load('diffuse', [
        './resources/dirt_01_diffuse-1024.png',
        './resources/grass1-albedo3-1024.png',
        './resources/sandyground-albedo-1024.png',
        './resources/worn-bumpy-rock-albedo-1024.png',
        './resources/rock-snow-ice-albedo-1024.png',
        './resources/snow-packed-albedo-1024.png',
        './resources/rough-wet-cobble-albedo-1024.png',
        './resources/sandy-rocks1-albedo-1024.png',
      ]);
      diffuse.onLoad = () => {     
        this._material.uniforms.diffuseMap.value = diffuse.Info['diffuse'].atlas;
      };

      const normal = new textures.TextureAtlas(params);
      normal.Load('normal', [
        './resources/dirt_01_normal-1024.jpg',
        './resources/grass1-normal-1024.jpg',
        './resources/sandyground-normal-1024.jpg',
        './resources/worn-bumpy-rock-normal-1024.jpg',
        './resources/rock-snow-ice-normal-1024.jpg',
        './resources/snow-packed-normal-1024.jpg',
        './resources/rough-wet-cobble-normal-1024.jpg',
        './resources/sandy-rocks1-normal-1024.jpg',
      ]);
      normal.onLoad = () => {     
        this._material.uniforms.normalMap.value = normal.Info['normal'].atlas;
      };

      this._material = new THREE.MeshStandardMaterial({
        wireframe: false,
        wireframeLinewidth: 1,
        color: 0xFFFFFF,
        side: THREE.FrontSide,
        vertexColors: THREE.VertexColors,
        // normalMap: texture,
      });

      this._material = new THREE.RawShaderMaterial({
        uniforms: {
          diffuseMap: {
          },
          normalMap: {
          },
          noiseMap: {
            value: noiseTexture
          },
        },
        vertexShader: terrain_shader.VS,
        fragmentShader: terrain_shader.PS,
        side: THREE.FrontSide
      });

      this._builder = new TerrainChunkRebuilder();

      this._InitNoise(params);
      this._InitBiomes(params);
      this._InitTerrain(params);
    }

    _InitNoise(params) {
      params.guiParams.noise = {
        octaves: 10,
        persistence: 0.5,
        lacunarity: 1.6,
        exponentiation: 7.5,
        height: 900.0,
        scale: 1800.0,
        seed: 1
      };

      const onNoiseChanged = () => {
        this._builder.Rebuild(this._chunks);
      };

      const noiseRollup = params.gui.addFolder('Terrain.Noise');
      noiseRollup.add(params.guiParams.noise, "scale", 32.0, 4096.0).onChange(
          onNoiseChanged);
      noiseRollup.add(params.guiParams.noise, "octaves", 1, 20, 1).onChange(
          onNoiseChanged);
      noiseRollup.add(params.guiParams.noise, "persistence", 0.25, 1.0).onChange(
          onNoiseChanged);
      noiseRollup.add(params.guiParams.noise, "lacunarity", 0.01, 4.0).onChange(
          onNoiseChanged);
      noiseRollup.add(params.guiParams.noise, "exponentiation", 0.1, 10.0).onChange(
          onNoiseChanged);
      noiseRollup.add(params.guiParams.noise, "height", 0, 20000).onChange(
          onNoiseChanged);

      this._noise = new noise.Noise(params.guiParams.noise);

      params.guiParams.heightmap = {
        height: 16,
      };

      const heightmapRollup = params.gui.addFolder('Terrain.Heightmap');
      heightmapRollup.add(params.guiParams.heightmap, "height", 0, 128).onChange(
          onNoiseChanged);
    }

    _InitBiomes(params) {
      params.guiParams.biomes = {
        octaves: 2,
        persistence: 0.5,
        lacunarity: 2.0,
        scale: 2048.0,
        noiseType: 'simplex',
        seed: 2,
        exponentiation: 1,
        height: 1.0
      };

      const onNoiseChanged = () => {
        this._builder.Rebuild(this._chunks);
      };

      const noiseRollup = params.gui.addFolder('Terrain.Biomes');
      noiseRollup.add(params.guiParams.biomes, "scale", 64.0, 4096.0).onChange(
          onNoiseChanged);
      noiseRollup.add(params.guiParams.biomes, "octaves", 1, 20, 1).onChange(
          onNoiseChanged);
      noiseRollup.add(params.guiParams.biomes, "persistence", 0.01, 1.0).onChange(
          onNoiseChanged);
      noiseRollup.add(params.guiParams.biomes, "lacunarity", 0.01, 4.0).onChange(
          onNoiseChanged);
      noiseRollup.add(params.guiParams.biomes, "exponentiation", 0.1, 10.0).onChange(
          onNoiseChanged);

      this._biomes = new noise.Noise(params.guiParams.biomes);

      const colourParams = {
        octaves: 1,
        persistence: 0.5,
        lacunarity: 2.0,
        exponentiation: 1.0,
        scale: 256.0,
        noiseType: 'simplex',
        seed: 2,
        height: 1.0,
      };
      this._colourNoise = new noise.Noise(colourParams);
    }

    _InitTerrain(params) {
      params.guiParams.terrain= {
        wireframe: false,
      };

      this._groups = [...new Array(6)].map(_ => new THREE.Group());
      params.scene.add(...this._groups);

      const terrainRollup = params.gui.addFolder('Terrain');
      terrainRollup.add(params.guiParams.terrain, "wireframe").onChange(() => {
        for (let k in this._chunks) {
          this._chunks[k].chunk._plane.material.wireframe = params.guiParams.terrain.wireframe;
        }
      });

      this._chunks = {};
      this._params = params;
    }

    _CellIndex(p) {
      const xp = p.x + _MIN_CELL_SIZE * 0.5;
      const yp = p.z + _MIN_CELL_SIZE * 0.5;
      const x = Math.floor(xp / _MIN_CELL_SIZE);
      const z = Math.floor(yp / _MIN_CELL_SIZE);
      return [x, z];
    }

    _CreateTerrainChunk(group, offset, width, resolution) {
      const params = {
        group: group,
        material: this._material,
        width: width,
        offset: offset,
        radius: _PLANET_RADIUS,
        resolution: resolution,
        biomeGenerator: this._biomes,
        colourGenerator: new TextureSplatter({biomeGenerator: this._biomes, colourNoise: this._colourNoise}),
        heightGenerators: [new HeightGenerator(this._noise, offset, 100000, 100000 + 1)],
      };

      return this._builder.AllocateChunk(params);
    }

    Update(_) {
      this._builder.Update();
      if (!this._builder.Busy) {
        this._UpdateVisibleChunks_Quadtree();
      }
    }

    _UpdateVisibleChunks_Quadtree() {
      function _Key(c) {
        return c.position[0] + '/' + c.position[1] + ' [' + c.size + ']' + ' [' + c.index + ']';
      }

      const q = new quadtree.CubeQuadTree({
        radius: _PLANET_RADIUS,
        min_node_size: _MIN_CELL_SIZE,
      });
      q.Insert(this._params.camera.position);

      const sides = q.GetChildren();

      let newTerrainChunks = {};
      const center = new THREE.Vector3();
      const dimensions = new THREE.Vector3();
      for (let i = 0; i < sides.length; i++) {
        this._groups[i].matrix = sides[i].transform;
        this._groups[i].matrixAutoUpdate = false;
        for (let c of sides[i].children) {
          c.bounds.getCenter(center);
          c.bounds.getSize(dimensions);
  
          const child = {
            index: i,
            group: this._groups[i],
            position: [center.x, center.y, center.z],
            bounds: c.bounds,
            size: dimensions.x,
          };
  
          const k = _Key(child);
          newTerrainChunks[k] = child;
        }
      }

      const intersection = utils.DictIntersection(this._chunks, newTerrainChunks);
      const difference = utils.DictDifference(newTerrainChunks, this._chunks);
      const recycle = Object.values(utils.DictDifference(this._chunks, newTerrainChunks));

      this._builder._old.push(...recycle);

      newTerrainChunks = intersection;

      for (let k in difference) {
        const [xp, yp, zp] = difference[k].position;

        const offset = new THREE.Vector3(xp, yp, zp);
        newTerrainChunks[k] = {
          position: [xp, zp],
          chunk: this._CreateTerrainChunk(
              difference[k].group, offset, difference[k].size, _MIN_CELL_RESOLUTION),
        };
      }

      this._chunks = newTerrainChunks;
    }
  }

  return {
    TerrainChunkManager: TerrainChunkManager
  }
})();
