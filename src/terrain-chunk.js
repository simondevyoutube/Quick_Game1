import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js';


export const terrain_chunk = (function() {

  class TerrainChunk {
    constructor(params) {
      this._params = params;
      this._Init(params);
    }
    
    Destroy() {
      this._params.group.remove(this._plane);
    }

    Hide() {
      this._plane.visible = false;
    }

    Show() {
      this._plane.visible = true;
    }

    _Init(params) {
      this._geometry = new THREE.BufferGeometry();
      this._plane = new THREE.Mesh(this._geometry, params.material);
      this._plane.castShadow = false;
      this._plane.receiveShadow = true;
      this._params.group.add(this._plane);
    }

    _GenerateHeight(v) {
      return this._params.heightGenerators[0].Get(v.x, v.y, v.z)[0];
    }

    *_Rebuild() {
      const _D = new THREE.Vector3();
      const _D1 = new THREE.Vector3();
      const _D2 = new THREE.Vector3();
      const _P = new THREE.Vector3();
      const _H = new THREE.Vector3();
      const _W = new THREE.Vector3();
      const _C = new THREE.Vector3();
      const _S = new THREE.Vector3();

      const _N = new THREE.Vector3();
      const _N1 = new THREE.Vector3();
      const _N2 = new THREE.Vector3();
      const _N3 = new THREE.Vector3();

      const positions = [];
      const colors = [];
      const normals = [];
      const tangents = [];
      const uvs = [];
      const weights1 = [];
      const weights2 = [];
      const indices = [];
      const wsPositions = [];

      const localToWorld = this._params.group.matrix;
      const resolution = this._params.resolution;
      const radius = this._params.radius;
      const offset = this._params.offset;
      const width = this._params.width;
      const half = width / 2;

      for (let x = 0; x < resolution + 1; x++) {
        const xp = width * x / resolution;
        for (let y = 0; y < resolution + 1; y++) {
          const yp = width * y / resolution;

          // Compute position
          _P.set(xp - half, yp - half, radius);
          _P.add(offset);
          _P.normalize();
          _D.copy(_P);
          _P.multiplyScalar(radius);
          _P.z -= radius;

          // Compute a world space position to sample noise
          _W.copy(_P);
          _W.applyMatrix4(localToWorld);

          const height = this._GenerateHeight(_W) * 0.25;

          // Purturb height along z-vector
          _H.copy(_D);
          _H.multiplyScalar(height);
          _P.add(_H);

          positions.push(_P.x, _P.y, _P.z);

          _S.set(_W.x, _W.y, height);

          const color = this._params.colourGenerator.GetColour(_S);
          colors.push(color.r, color.g, color.b);
          normals.push(_D.x, _D.y, _D.z);
          tangents.push(1, 0, 0, 1);
          wsPositions.push(_W.x, _W.y, height);
          // TODO GUI
          uvs.push(_P.x / 200.0, _P.y / 200.0);
        }
      }
      yield;

      for (let i = 0; i < resolution; i++) {
        for (let j = 0; j < resolution; j++) {
          indices.push(
              i * (resolution + 1) + j,
              (i + 1) * (resolution + 1) + j + 1,
              i * (resolution + 1) + j + 1);
          indices.push(
              (i + 1) * (resolution + 1) + j,
              (i + 1) * (resolution + 1) + j + 1,
              i * (resolution + 1) + j);
        }
      }
      yield;

      const up = [...normals];

      for (let i = 0, n = indices.length; i < n; i+= 3) {
        const i1 = indices[i] * 3;
        const i2 = indices[i+1] * 3;
        const i3 = indices[i+2] * 3;

        _N1.fromArray(positions, i1);
        _N2.fromArray(positions, i2);
        _N3.fromArray(positions, i3);

        _D1.subVectors(_N3, _N2);
        _D2.subVectors(_N1, _N2);
        _D1.cross(_D2);

        normals[i1] += _D1.x;
        normals[i2] += _D1.x;
        normals[i3] += _D1.x;

        normals[i1+1] += _D1.y;
        normals[i2+1] += _D1.y;
        normals[i3+1] += _D1.y;

        normals[i1+2] += _D1.z;
        normals[i2+2] += _D1.z;
        normals[i3+2] += _D1.z;
      }
      yield;

      for (let i = 0, n = normals.length; i < n; i+=3) {
        _N.fromArray(normals, i);
        _N.normalize();
        normals[i] = _N.x;
        normals[i+1] = _N.y;
        normals[i+2] = _N.z;
      }
      yield;

      let count = 0;
      for (let i = 0, n = indices.length; i < n; i+=3) {
        const splats = [];
        const i1 = indices[i] * 3;
        const i2 = indices[i+1] * 3;
        const i3 = indices[i+2] * 3;
        const indexes = [i1, i2, i3];
        for (let j = 0; j < 3; j++) {
          const j1 = indexes[j];
          _P.fromArray(wsPositions, j1);
          _N.fromArray(normals, j1);
          _D.fromArray(up, j1);
          const s = this._params.colourGenerator.GetSplat(_P, _N, _D);
          splats.push(s);
        }

        const splatStrengths = {};
        for (let k in splats[0]) {
          splatStrengths[k] = {key: k, strength: 0.0};
        }
        for (let curSplat of splats) {
          for (let k in curSplat) {
            splatStrengths[k].strength += curSplat[k].strength;
          }
        }

        let typeValues = Object.values(splatStrengths);
        typeValues.sort((a, b) => {
          if (a.strength < b.strength) {
            return 1;
          }
          if (a.strength > b.strength) {
            return -1;
          }
          return 0;
        });

        const w1 = indices[i] * 4;
        const w2 = indices[i+1] * 4;
        const w3 = indices[i+2] * 4;

        for (let s = 0; s < 3; s++) {
          let total = (
              splats[s][typeValues[0].key].strength +
              splats[s][typeValues[1].key].strength +
              splats[s][typeValues[2].key].strength +
              splats[s][typeValues[3].key].strength);
          const normalization = 1.0 / total;

          splats[s][typeValues[0].key].strength *= normalization;
          splats[s][typeValues[1].key].strength *= normalization;
          splats[s][typeValues[2].key].strength *= normalization;
          splats[s][typeValues[3].key].strength *= normalization;
        }
 
        weights1.push(splats[0][typeValues[3].key].index);
        weights1.push(splats[0][typeValues[2].key].index);
        weights1.push(splats[0][typeValues[1].key].index);
        weights1.push(splats[0][typeValues[0].key].index);

        weights1.push(splats[1][typeValues[3].key].index);
        weights1.push(splats[1][typeValues[2].key].index);
        weights1.push(splats[1][typeValues[1].key].index);
        weights1.push(splats[1][typeValues[0].key].index);

        weights1.push(splats[2][typeValues[3].key].index);
        weights1.push(splats[2][typeValues[2].key].index);
        weights1.push(splats[2][typeValues[1].key].index);
        weights1.push(splats[2][typeValues[0].key].index);

        weights2.push(splats[0][typeValues[3].key].strength);
        weights2.push(splats[0][typeValues[2].key].strength);
        weights2.push(splats[0][typeValues[1].key].strength);
        weights2.push(splats[0][typeValues[0].key].strength);

        weights2.push(splats[1][typeValues[3].key].strength);
        weights2.push(splats[1][typeValues[2].key].strength);
        weights2.push(splats[1][typeValues[1].key].strength);
        weights2.push(splats[1][typeValues[0].key].strength);

        weights2.push(splats[2][typeValues[3].key].strength);
        weights2.push(splats[2][typeValues[2].key].strength);
        weights2.push(splats[2][typeValues[1].key].strength);
        weights2.push(splats[2][typeValues[0].key].strength);

        count++;
        if ((count % 1000) == 0) {
          yield;
        }
      }
      yield;

      function _Unindex(src, stride) {
        const dst = [];
        for (let i = 0, n = indices.length; i < n; i+= 3) {
          const i1 = indices[i] * stride;
          const i2 = indices[i+1] * stride;
          const i3 = indices[i+2] * stride;

          for (let j = 0; j < stride; j++) {
            dst.push(src[i1 + j]);
          }
          for (let j = 0; j < stride; j++) {
            dst.push(src[i2 + j]);
          }
          for (let j = 0; j < stride; j++) {
            dst.push(src[i3 + j]);
          }
        }
        return dst;
      }

      const uiPositions = _Unindex(positions, 3);
      yield;

      const uiColours = _Unindex(colors, 3);
      yield;

      const uiNormals = _Unindex(normals, 3);
      yield;

      const uiTangents = _Unindex(tangents, 4);
      yield;

      const uiUVs = _Unindex(uvs, 2);
      yield;

      const uiWeights1 = weights1;
      const uiWeights2 = weights2;

      this._geometry.setAttribute(
          'position', new THREE.Float32BufferAttribute(uiPositions, 3));
      this._geometry.setAttribute(
          'color', new THREE.Float32BufferAttribute(uiColours, 3));
      this._geometry.setAttribute(
          'normal', new THREE.Float32BufferAttribute(uiNormals, 3));
      this._geometry.setAttribute(
          'tangent', new THREE.Float32BufferAttribute(uiTangents, 4));
      this._geometry.setAttribute(
          'weights1', new THREE.Float32BufferAttribute(uiWeights1, 4));
      this._geometry.setAttribute(
          'weights2', new THREE.Float32BufferAttribute(uiWeights2, 4));
      this._geometry.setAttribute(
          'uv', new THREE.Float32BufferAttribute(uiUVs, 2));
    }
  }

  return {
    TerrainChunk: TerrainChunk
  }
})();
