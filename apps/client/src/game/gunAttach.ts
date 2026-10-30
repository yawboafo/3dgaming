import * as THREE from 'three';
import type { WeaponSpec } from '@town/shared';

export interface GunTemplate {
  model: THREE.Object3D;
  spec: WeaponSpec['model'];
}

/**
 * Parent a gun to a hand bone so it sits in the palm with the barrel along the fingers.
 *
 * The rig's bone axes aren't known ahead of time, so this reads the bind pose instead: the hand's
 * bind orientation, the direction from the hand to its fingers (barrel), and toward the thumb
 * (the top of the gun in a pistol grip). The gun is shifted so its grip point lands on the bone.
 * Armature scale is cancelled so `scale` is metres.
 */
export function attachGun(root: THREE.Object3D, hand: THREE.Bone, t: GunTemplate): THREE.Object3D {
  const skinned = findSkinned(root, hand);
  const gun = t.model.clone(true);
  if (!skinned) {
    hand.add(gun);
    return gun;
  }
  const bones = skinned.skeleton.bones;
  const bind = (b: THREE.Bone) => {
    const i = bones.indexOf(b);
    return skinned.skeleton.boneInverses[i]!.clone().invert();
  };
  const handBind = bind(hand);
  const hp = new THREE.Vector3();
  const hq = new THREE.Quaternion();
  const hs = new THREE.Vector3();
  handBind.decompose(hp, hq, hs);

  const child = (re: RegExp) =>
    hand.children.find((c): c is THREE.Bone => (c as THREE.Bone).isBone && re.test(c.name));
  const toward = (b: THREE.Bone | undefined, fallback: THREE.Vector3) =>
    b ? new THREE.Vector3().setFromMatrixPosition(bind(b)).sub(hp).normalize() : fallback;
  const fingers = toward(child(/middle|index/i) ?? child(/./), new THREE.Vector3(-1, 0, 0));
  const up = toward(child(/thumb/i), new THREE.Vector3(0, 1, 0));
  up.sub(fingers.clone().multiplyScalar(up.dot(fingers))).normalize();

  // Gun basis in bind space: its barrel axis → fingers, +Y → up.
  const z = t.spec.barrel === '-z' ? fingers.clone().negate() : fingers.clone();
  const x = new THREE.Vector3().crossVectors(up, z).normalize();
  const gunBind = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(x, up, z),
  );

  const local = hq.clone().invert().multiply(gunBind);
  local.multiply(
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...t.spec.rot.map(THREE.MathUtils.degToRad)),
    ),
  );
  // Bind matrices can carry a different scale than the live armature: use the hand's real one.
  root.updateMatrixWorld(true);
  const rootScale = root.getWorldScale(new THREE.Vector3()).x || 1;
  const handScale = (hand.getWorldScale(new THREE.Vector3()).x || 1) / rootScale;
  const scale = t.spec.scale / handScale;
  gun.quaternion.copy(local);
  gun.scale.setScalar(scale);
  const grip = new THREE.Vector3(...t.spec.grip).multiplyScalar(scale).applyQuaternion(local);
  gun.position
    .set(...t.spec.offset)
    .divideScalar(handScale)
    .sub(grip);
  hand.add(gun);
  return gun;
}

function findSkinned(root: THREE.Object3D, bone: THREE.Bone): THREE.SkinnedMesh | undefined {
  let found: THREE.SkinnedMesh | undefined;
  root.traverse((o) => {
    if (
      !found &&
      (o as THREE.SkinnedMesh).isSkinnedMesh &&
      (o as THREE.SkinnedMesh).skeleton.bones.includes(bone)
    ) {
      found = o as THREE.SkinnedMesh;
    }
  });
  return found;
}
