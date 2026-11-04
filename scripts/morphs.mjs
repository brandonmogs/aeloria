// The character creator's sliders: each is one MakeHuman target (a unipolar
// slider, 0 to 1) or a pair of opposite targets (a bipolar slider, -1 to 1),
// mirrored across the body's two sides where MakeHuman keeps a target per
// side. scripts/build-characters.mjs bakes every slider's poles into
// public/models/characters/morphs_<m|f>.{json,bin} (see bakeMorphs there),
// and src/render/morphs.ts applies them at runtime. The labels are the
// creator's; the groups are its sections, tab by tab.

/** @typedef {{ id: string, label: string, tab: 'face' | 'body' }} MorphGroup */
export const MORPH_GROUPS = [
  { id: 'faceShape', label: 'Face shape', tab: 'face' },
  { id: 'head', label: 'Head', tab: 'face' },
  { id: 'forehead', label: 'Forehead', tab: 'face' },
  { id: 'brow', label: 'Brow', tab: 'face' },
  { id: 'eyes', label: 'Eyes', tab: 'face' },
  { id: 'nose', label: 'Nose', tab: 'face' },
  { id: 'cheeks', label: 'Cheeks', tab: 'face' },
  { id: 'mouth', label: 'Mouth', tab: 'face' },
  { id: 'chin', label: 'Chin and jaw', tab: 'face' },
  { id: 'ears', label: 'Ears', tab: 'face' },
  { id: 'neck', label: 'Neck', tab: 'face' },
  { id: 'build', label: 'Build', tab: 'body' },
  { id: 'torso', label: 'Torso', tab: 'body' },
  { id: 'chest', label: 'Chest', tab: 'body' },
  { id: 'waist', label: 'Waist and hips', tab: 'body' },
  { id: 'arms', label: 'Arms', tab: 'body' },
  { id: 'hands', label: 'Hands', tab: 'body' },
  { id: 'legs', label: 'Legs', tab: 'body' },
  { id: 'feet', label: 'Feet', tab: 'body' },
];

/**
 * A slider. `target` names the MakeHuman target under `dir`, with `%`
 * standing for the side (l/r, both applied together) and `$sex` for the
 * body's sex; `min`/`max` are the suffixes of a bipolar pair, absent for a
 * single target. `female` limits a slider to the women's bodies.
 * @typedef {{ id: string, label: string, group: string, dir: string, target: string, min?: string, max?: string, female?: boolean }} Morph
 */

const bi = (id, label, group, dir, target, min = 'decr', max = 'incr', extra = {}) => ({ id, label, group, dir, target, min, max, ...extra });
const uni = (id, label, group, dir, target, extra = {}) => ({ id, label, group, dir, target, ...extra });

/** @type {Morph[]} */
export const MORPHS = [
  // --- Face ---------------------------------------------------------------------------
  uni('faceOval', 'Oval', 'faceShape', 'head', 'head-oval'),
  uni('faceRound', 'Round', 'faceShape', 'head', 'head-round'),
  uni('faceSquare', 'Square', 'faceShape', 'head', 'head-square'),
  uni('faceRectangular', 'Long', 'faceShape', 'head', 'head-rectangular'),
  uni('faceTriangular', 'Triangular', 'faceShape', 'head', 'head-triangular'),
  uni('faceHeart', 'Heart', 'faceShape', 'head', 'head-invertedtriangular'),
  uni('faceDiamond', 'Diamond', 'faceShape', 'head', 'head-diamond'),

  bi('headWidth', 'Head width', 'head', 'head', 'head-scale-horiz'),
  bi('headHeight', 'Head height', 'head', 'head', 'head-scale-vert'),
  bi('headDepth', 'Head depth', 'head', 'head', 'head-scale-depth'),
  bi('headBack', 'Back of head', 'head', 'head', 'head-back-scale-depth'),
  bi('faceFullness', 'Face fullness', 'head', 'head', 'head-fat'),
  bi('faceAge', 'Face age', 'head', 'head', 'head-age'),

  bi('foreheadHeight', 'Forehead height', 'forehead', 'forehead', 'forehead-scale-vert'),
  bi('foreheadSlope', 'Forehead slope', 'forehead', 'forehead', 'forehead-nubian'),
  bi('temples', 'Temples', 'forehead', 'forehead', 'forehead-temple'),
  bi('foreheadBulge', 'Forehead bulge', 'forehead', 'forehead', 'forehead-trans', 'backward', 'forward'),

  bi('browAngle', 'Brow angle', 'brow', 'eyebrows', 'eyebrows-angle', 'down', 'up'),
  bi('browHeight', 'Brow height', 'brow', 'eyebrows', 'eyebrows-trans', 'down', 'up'),
  bi('browRidge', 'Brow ridge', 'brow', 'eyebrows', 'eyebrows-trans', 'backward', 'forward'),

  bi('eyeSize', 'Eye size', 'eyes', 'eyes', '%-eye-scale'),
  bi('eyeHeight', 'Eye height', 'eyes', 'eyes', '%-eye-trans', 'down', 'up'),
  bi('eyeSpacing', 'Eye spacing', 'eyes', 'eyes', '%-eye-trans', 'in', 'out'),
  bi('eyeOuterCornerWidth', 'Outer corner width', 'eyes', 'eyes', '%-eye-push1', 'in', 'out'),
  bi('eyeInnerCornerWidth', 'Inner corner width', 'eyes', 'eyes', '%-eye-push2', 'in', 'out'),
  bi('eyeOuterCornerHeight', 'Outer corner height', 'eyes', 'eyes', '%-eye-corner1', 'down', 'up'),
  bi('eyeInnerCornerHeight', 'Inner corner height', 'eyes', 'eyes', '%-eye-corner2', 'down', 'up'),
  bi('eyeOpening', 'Eye opening', 'eyes', 'eyes', '%-eye-height2'),
  bi('eyeUpperLid', 'Upper lid', 'eyes', 'eyes', '%-eye-height1'),
  bi('eyeLowerLid', 'Lower lid', 'eyes', 'eyes', '%-eye-height3'),
  bi('eyeFoldHeight', 'Eyelid fold height', 'eyes', 'eyes', '%-eye-eyefold', 'down', 'up'),
  bi('eyeFoldAngle', 'Eyelid fold angle', 'eyes', 'eyes', '%-eye-eyefold-angle', 'down', 'up'),
  bi('eyeFoldDepth', 'Eyelid fold depth', 'eyes', 'eyes', '%-eye-eyefold', 'concave', 'convex'),
  bi('eyeEpicanthus', 'Epicanthic fold', 'eyes', 'eyes', '%-eye-epicanthus', 'in', 'out'),
  bi('eyeBags', 'Eye bags', 'eyes', 'eyes', '%-eye-bag'),
  bi('eyeBagHeight', 'Eye bag height', 'eyes', 'eyes', '%-eye-bag-height'),

  bi('noseWidth', 'Nose width', 'nose', 'nose', 'nose-scale-horiz'),
  bi('noseLength', 'Nose length', 'nose', 'nose', 'nose-scale-vert'),
  bi('noseDepth', 'Nose depth', 'nose', 'nose', 'nose-scale-depth'),
  bi('noseHeight', 'Nose height', 'nose', 'nose', 'nose-trans', 'down', 'up'),
  bi('noseProtrusion', 'Nose protrusion', 'nose', 'nose', 'nose-trans', 'backward', 'forward'),
  bi('noseBridgeWidth', 'Bridge width', 'nose', 'nose', 'nose-width1'),
  bi('noseMidWidth', 'Middle width', 'nose', 'nose', 'nose-width2'),
  bi('noseBaseWidth', 'Base width', 'nose', 'nose', 'nose-width3'),
  bi('noseBridgeCurve', 'Bridge curve', 'nose', 'nose', 'nose-curve', 'concave', 'convex'),
  bi('noseHump', 'Hump', 'nose', 'nose', 'nose-hump'),
  bi('noseGreek', 'Straight bridge', 'nose', 'nose', 'nose-greek'),
  bi('noseTipHeight', 'Tip height', 'nose', 'nose', 'nose-point', 'down', 'up'),
  bi('noseTipWidth', 'Tip width', 'nose', 'nose', 'nose-point-width'),
  bi('noseBaseHeight', 'Base height', 'nose', 'nose', 'nose-base', 'down', 'up'),
  bi('nostrilWidth', 'Nostril width', 'nose', 'nose', 'nose-nostrils-width'),
  bi('nostrilAngle', 'Nostril angle', 'nose', 'nose', 'nose-nostrils-angle', 'down', 'up'),
  bi('noseFlaring', 'Flaring', 'nose', 'nose', 'nose-flaring'),
  bi('noseSeptum', 'Septum angle', 'nose', 'nose', 'nose-septumangle'),
  bi('noseCompression', 'Compression', 'nose', 'nose', 'nose-compression', 'compress', 'uncompress'),
  bi('noseVolume', 'Volume', 'nose', 'nose', 'nose-volume'),

  bi('cheekbones', 'Cheekbones', 'cheeks', 'cheek', '%-cheek-bones'),
  bi('cheekFullness', 'Cheek fullness', 'cheeks', 'cheek', '%-cheek-volume'),
  bi('cheekInner', 'Inner cheek', 'cheeks', 'cheek', '%-cheek-inner'),
  bi('cheekHeight', 'Cheek height', 'cheeks', 'cheek', '%-cheek-trans', 'down', 'up'),

  bi('mouthWidth', 'Mouth width', 'mouth', 'mouth', 'mouth-scale-horiz'),
  bi('mouthHeight', 'Mouth height', 'mouth', 'mouth', 'mouth-scale-vert'),
  bi('mouthDepth', 'Mouth depth', 'mouth', 'mouth', 'mouth-scale-depth'),
  bi('mouthPosition', 'Mouth position', 'mouth', 'mouth', 'mouth-trans', 'down', 'up'),
  bi('mouthProtrusion', 'Mouth protrusion', 'mouth', 'mouth', 'mouth-trans', 'backward', 'forward'),
  bi('lipCorners', 'Lip corners', 'mouth', 'mouth', 'mouth-angles', 'down', 'up'),
  bi('upperLipHeight', 'Upper lip height', 'mouth', 'mouth', 'mouth-upperlip-height'),
  bi('upperLipFullness', 'Upper lip fullness', 'mouth', 'mouth', 'mouth-upperlip-volume'),
  bi('upperLipWidth', 'Upper lip width', 'mouth', 'mouth', 'mouth-upperlip-width'),
  bi('upperLipEdge', 'Upper lip edge', 'mouth', 'mouth', 'mouth-upperlip-ext', 'down', 'up'),
  bi('upperLipCentre', 'Upper lip centre', 'mouth', 'mouth', 'mouth-upperlip-middle', 'down', 'up'),
  bi('lowerLipHeight', 'Lower lip height', 'mouth', 'mouth', 'mouth-lowerlip-height'),
  bi('lowerLipFullness', 'Lower lip fullness', 'mouth', 'mouth', 'mouth-lowerlip-volume'),
  bi('lowerLipWidth', 'Lower lip width', 'mouth', 'mouth', 'mouth-lowerlip-width'),
  bi('lowerLipEdge', 'Lower lip edge', 'mouth', 'mouth', 'mouth-lowerlip-ext', 'down', 'up'),
  bi('lowerLipCentre', 'Lower lip centre', 'mouth', 'mouth', 'mouth-lowerlip-middle', 'down', 'up'),
  bi('cupidsBow', 'Cupid bow', 'mouth', 'mouth', 'mouth-cupidsbow'),
  bi('cupidsBowWidth', 'Cupid bow width', 'mouth', 'mouth', 'mouth-cupidsbow-width'),
  bi('philtrum', 'Philtrum', 'mouth', 'mouth', 'mouth-philtrum-volume'),
  bi('dimples', 'Dimples', 'mouth', 'mouth', 'mouth-dimples', 'in', 'out'),
  bi('laughLines', 'Laugh lines', 'mouth', 'mouth', 'mouth-laugh-lines', 'in', 'out'),

  bi('chinWidth', 'Chin width', 'chin', 'chin', 'chin-width'),
  bi('chinHeight', 'Chin height', 'chin', 'chin', 'chin-height'),
  bi('chinProminence', 'Chin prominence', 'chin', 'chin', 'chin-prominent'),
  bi('chinCleft', 'Chin cleft', 'chin', 'chin', 'chin-cleft'),
  uni('chinPointed', 'Pointed chin', 'chin', 'chin', 'chin-triangle'),
  bi('jawAngle', 'Jaw angle', 'chin', 'chin', 'chin-bones'),
  bi('jawDrop', 'Jaw drop', 'chin', 'chin', 'chin-jaw-drop'),
  bi('underbite', 'Underbite', 'chin', 'chin', 'chin-prognathism'),

  bi('earSize', 'Ear size', 'ears', 'ears', '%-ear-scale'),
  bi('earHeight', 'Ear height', 'ears', 'ears', '%-ear-scale-vert'),
  bi('earWidth', 'Ear width', 'ears', 'ears', '%-ear-scale-depth'),
  bi('earPosition', 'Ear position', 'ears', 'ears', '%-ear-trans', 'down', 'up'),
  bi('earPlacement', 'Ear placement', 'ears', 'ears', '%-ear-trans', 'backward', 'forward'),
  bi('earRotation', 'Ear rotation', 'ears', 'ears', '%-ear-rot', 'backward', 'forward'),
  bi('earLobe', 'Earlobe', 'ears', 'ears', '%-ear-lobe'),
  bi('earFlare', 'Ear flare', 'ears', 'ears', '%-ear-wing'),
  bi('earFlap', 'Ear flap', 'ears', 'ears', '%-ear-flap'),
  bi('earTip', 'Ear tip', 'ears', 'ears', '%-ear-shape', 'pointed', 'triangle'),
  bi('earOutline', 'Ear outline', 'ears', 'ears', '%-ear-shape', 'square', 'round'),

  bi('neckWidth', 'Neck width', 'neck', 'neck', 'neck-scale-horiz'),
  bi('neckLength', 'Neck length', 'neck', 'neck', 'neck-scale-vert'),
  bi('neckDepth', 'Neck depth', 'neck', 'neck', 'neck-scale-depth'),
  bi('neckNape', 'Nape', 'neck', 'neck', 'neck-back-scale-depth'),
  bi('doubleChin', 'Double chin', 'neck', 'neck', 'neck-double'),

  // --- Body ---------------------------------------------------------------------------
  bi('muscle', 'Muscle', 'build', 'macrodetails', 'universal-$sex-young-', 'minmuscle-averageweight', 'maxmuscle-averageweight'),
  bi('weight', 'Weight', 'build', 'macrodetails', 'universal-$sex-young-', 'averagemuscle-minweight', 'averagemuscle-maxweight'),
  bi('shoulderWidth', 'Shoulder width', 'build', 'measure', 'measure-shoulder-dist'),
  bi('deltoids', 'Deltoids', 'build', 'armslegs', '%-upperarm-shoulder-muscle'),
  bi('backMuscles', 'Back muscles', 'build', 'torso', 'torso-muscle-dorsi'),

  bi('torsoWidth', 'Torso width', 'torso', 'torso', 'torso-scale-horiz'),
  bi('torsoDepth', 'Torso depth', 'torso', 'torso', 'torso-scale-depth'),
  bi('torsoLength', 'Torso length', 'torso', 'torso', 'torso-scale-vert'),
  bi('vShape', 'V-shape', 'torso', 'torso', 'torso-vshape'),
  bi('neckGirth', 'Neck girth', 'torso', 'measure', 'measure-neck-circ'),

  bi('pectorals', 'Pectorals', 'chest', 'torso', 'torso-muscle-pectoral'),
  bi('chestGirth', 'Chest girth', 'chest', 'measure', 'measure-bust-circ'),
  bi('ribcage', 'Ribcage', 'chest', 'measure', 'measure-underbust-circ'),
  bi('chestBreadth', 'Chest breadth', 'chest', 'measure', 'measure-frontchest-dist'),
  bi('bustSize', 'Bust size', 'chest', 'breast', 'female-young-averagemuscle-averageweight-', 'mincup-averagefirmness', 'maxcup-averagefirmness', { female: true }),
  bi('bustFirmness', 'Bust firmness', 'chest', 'breast', 'female-young-averagemuscle-averageweight-', 'averagecup-minfirmness', 'averagecup-maxfirmness', { female: true }),
  bi('bustHeight', 'Bust height', 'chest', 'breast', 'breast-trans', 'down', 'up', { female: true }),
  bi('bustSpacing', 'Bust spacing', 'chest', 'breast', 'breast-dist', 'decr', 'incr', { female: true }),
  bi('bustPoint', 'Bust point', 'chest', 'breast', 'breast-point', 'decr', 'incr', { female: true }),

  bi('waistGirth', 'Waist girth', 'waist', 'measure', 'measure-waist-circ'),
  bi('waistline', 'Waistline', 'waist', 'hip', 'hip-waist', 'down', 'up'),
  bi('belly', 'Belly', 'waist', 'stomach', 'stomach-pregnant'),
  bi('abs', 'Abdominal tone', 'waist', 'stomach', 'stomach-tone'),
  bi('hipWidth', 'Hip width', 'waist', 'hip', 'hip-scale-horiz'),
  bi('hipDepth', 'Hip depth', 'waist', 'hip', 'hip-scale-depth'),
  bi('hipGirth', 'Hip girth', 'waist', 'measure', 'measure-hips-circ'),
  bi('pelvisHeight', 'Pelvis height', 'waist', 'hip', 'hip-scale-vert'),
  bi('seat', 'Seat', 'waist', 'buttocks', 'buttocks-volume'),

  bi('upperArmLength', 'Upper arm length', 'arms', 'measure', 'measure-upperarm-length'),
  bi('forearmLength', 'Forearm length', 'arms', 'measure', 'measure-lowerarm-length'),
  bi('upperArmWidth', 'Upper arm width', 'arms', 'armslegs', '%-upperarm-scale-depth'),
  bi('upperArmDepth', 'Upper arm depth', 'arms', 'armslegs', '%-upperarm-scale-vert'),
  bi('upperArmMuscle', 'Upper arm muscle', 'arms', 'armslegs', '%-upperarm-muscle'),
  bi('upperArmFat', 'Upper arm fat', 'arms', 'armslegs', '%-upperarm-fat'),
  bi('forearmWidth', 'Forearm width', 'arms', 'armslegs', '%-lowerarm-scale-depth'),
  bi('forearmDepth', 'Forearm depth', 'arms', 'armslegs', '%-lowerarm-scale-vert'),
  bi('forearmMuscle', 'Forearm muscle', 'arms', 'armslegs', '%-lowerarm-muscle'),
  bi('forearmFat', 'Forearm fat', 'arms', 'armslegs', '%-lowerarm-fat'),
  bi('wrist', 'Wrist', 'arms', 'measure', 'measure-wrist-circ'),

  bi('handSize', 'Hand size', 'hands', 'armslegs', '%-hand-scale'),
  bi('fingerLength', 'Finger length', 'hands', 'armslegs', '%-hand-fingers-length'),
  bi('fingerThickness', 'Finger thickness', 'hands', 'armslegs', '%-hand-fingers-diameter'),
  bi('fingerSpread', 'Finger spread', 'hands', 'armslegs', '%-hand-fingers-distance'),

  bi('thighLength', 'Thigh length', 'legs', 'measure', 'measure-upperleg-height'),
  bi('shinLength', 'Shin length', 'legs', 'measure', 'measure-lowerleg-height'),
  bi('thighWidth', 'Thigh width', 'legs', 'armslegs', '%-upperleg-scale-horiz'),
  bi('thighDepth', 'Thigh depth', 'legs', 'armslegs', '%-upperleg-scale-depth'),
  bi('thighMuscle', 'Thigh muscle', 'legs', 'armslegs', '%-upperleg-muscle'),
  bi('thighFat', 'Thigh fat', 'legs', 'armslegs', '%-upperleg-fat'),
  bi('calfWidth', 'Calf width', 'legs', 'armslegs', '%-lowerleg-scale-horiz'),
  bi('calfDepth', 'Calf depth', 'legs', 'armslegs', '%-lowerleg-scale-depth'),
  bi('calfMuscle', 'Calf muscle', 'legs', 'armslegs', '%-lowerleg-muscle'),
  bi('calfFat', 'Calf fat', 'legs', 'armslegs', '%-lowerleg-fat'),
  bi('knee', 'Knee', 'legs', 'measure', 'measure-knee-circ'),
  bi('ankle', 'Ankle', 'legs', 'measure', 'measure-ankle-circ'),
  bi('kneeAngle', 'Knee angle', 'legs', 'armslegs', '%-leg-valgus'),

  bi('footSize', 'Foot size', 'feet', 'armslegs', '%-foot-scale'),
  bi('footWidth', 'Foot width', 'feet', 'armslegs', '%-foot-scale-horiz'),
  bi('footLength', 'Foot length', 'feet', 'armslegs', '%-foot-scale-depth'),
];

/** The sliders a sex gets, in order. */
export function morphsFor(sex) {
  return MORPHS.filter((m) => !m.female || sex === 'female');
}

/**
 * The target files (paths under data/targets, without the extension) one
 * pole of a slider layers on the body, each at weight 1: the `max` side for
 * `+`, the `min` side for `-`, both sides of a mirrored target.
 */
export function poleTargets(morph, pole, sex) {
  const suffix = pole === '+' ? morph.max : morph.min;
  if (pole === '-' && suffix === undefined) return [];
  const base = morph.target.replace('$sex', sex);
  const name = suffix === undefined ? base : base.endsWith('-') ? base + suffix : `${base}-${suffix}`;
  const sides = name.includes('%') ? [name.replace('%', 'l'), name.replace('%', 'r')] : [name];
  return sides.map((n) => `${morph.dir}/${n}`);
}

/** '+' for every slider, '-' as well for the bipolar ones. */
export function polesOf(morph) {
  return morph.min === undefined ? ['+'] : ['+', '-'];
}
