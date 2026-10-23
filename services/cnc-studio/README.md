# CNC Studio 0.7.0

Static browser CNC engineering workbench: HTML/CSS/ES modules, Web Workers,
WebGL and OpenCascade WASM. No local Laya service is called.

- `index.html`: existing STEP recognition, three-axis rough/finish CAM,
  FANUC-style draft output and heightfield stock simulation.
- `sixaxis.html`: generic XYZABC NC verification and volumetric stock removal.
- `research.html`: official-product research and feature coverage.
- `review-report.json`: three complete review rounds with named cases.

## Workflow

Load NC or the supplied demo, configure initial XYZABC, machine limits, stock,
material, tools and fixtures, then run analysis. Inspect alerts, 3D/2D views,
sections and axis curves. Alerts jump to the NC line. Playback supports step,
rewind, speed and stop-on-alert. Load a STEP reference, align it and compare
finished stock. Export original NC, project JSON, voxel STL or a JSON report.
Projects preserve NC and configuration; retain STEP files separately.

Ctrl+Enter runs analysis; Space toggles playback outside inputs. Drag rotates,
wheel zooms. Setup/code changes revoke previous results and derived exports.

## Kinematics

Fixed workpiece, one G54 work frame in mm. A/B/C are right-hand active rotations
about fixed X/Y/Z axes, degrees, with column vectors:

- Default `R = Rz(C) Ry(B) Rx(A)`; alternative `R = Rx(A) Ry(B) Rz(C)`.
- TCP: `tip = XYZ`; direction from tip to holder is `R [0,0,1]`.
- Pivot: `tip = XYZ - R [0,0,tool.length]`.

XYZABC interpolate within each move. Signed unwrapped angles are preserved;
no shortest-path wrapping. This is generic forward kinematics, not a validated
physical six-joint head, inverse kinematics, table/table machine or FANUC RTCP.

## NC subset and time

G0/G1/G2/G3; G17/G18/G19; IJK or positive/negative R; full circles and helical
motion; G90.1/G91.1; G20/G21; G90/G91; G54; G93/G94; T/M6; M3/M4/M5/S.
ABC can accompany arcs. G18 uses the right-handed ZX plane: G03 from X1 Z0
around the origin travels toward X0 Z-1. Default maximum arc tessellation error
is 0.05 mm; radial endpoint inconsistency consumes at most 10% of that tolerance.

G93 requires F in every feed block: duration = 60/F seconds. Arc subdivisions
share block time. G94 uses XYZ distance for mixed motion and angular travel
for pure rotation. Rapid time uses the slowest configured axis. Acceleration,
jerk, spindle ramp, tool changes and M-code waits are not modeled.

Six-axis G43/H, G43.4, G68.2, G41/G42, G53/G28, other work offsets, canned
cycles, macros, subprograms, M00/M01 and unsupported words stop parsing. Supply
explicitly converted tip/pivot coordinates. Legacy three-axis G43 retains its
previous advisory behavior; that is not a machine H-table simulation.

## Geometry and bounds

The rectangular stock is a 3D voxel grid, fitted exactly to input dimensions.
Multiple vertical intervals retain side holes and undercuts. Tool profiles are
flat endmill, spherical-tip endmill and 118-degree drill. Shank and holder are
cylinders. Rotary sweep sampling uses travel and tool reach to bound spacing
to 0.45 of the smallest cell. First-removal timestamps allow reverse playback.

Rapid and stopped-spindle motion never remove stock and raise alerts. Other
checks cover shank/holder-stock contacts, axis travel/speed, spindle rpm and
conservative tool/fixture box envelopes. Fixture corner near misses may be
reported. Voxel-center testing can miss sub-voxel features; this is not exact
Boolean material removal or a guaranteed continuous collision solver. No full
machine body, fixture mesh, force, wear, heat or deflection model is included.

Materials affect estimated mass only: Al6061 2.70, S45C 7.85, SUS304 7.93,
machining wax 0.90 g/cm³. Limits: 3 MB NC, 120,000 source lines, 80,000 parsed
motion segments, 700,000 voxels, 120,000 sweep samples, 180 million voxel
candidate checks. Coarsen resolution or split NC when limits are reached.

## STEP reference and existing CAM

Reference STEP is normalized to X/Y bounding-box minimum = 0 and top Z = 0,
then the explicit offset is applied. Validate this placement against NC G54.
Single-solid comparison uses even/odd vertical ray intervals, preserving
enclosed cavities. Overcut/residual volumes are voxel-center estimates within
stock bounds, subject also to reference tessellation. Target outside stock is
flagged. Multiple solids can be previewed but must be split for comparison.

The original CAM workbench still generates bounded 2.5D and single-solid
+Z-accessible three-axis rough/finish drafts. It does not automatically plan
simultaneous six-axis NC. Arbitrary reference geometry does not establish
tool accessibility. Side features require suitable external CAM/NC.
Optional MiniLM advisory ranking is lazy-loaded; regression uses mocked
embeddings. Live remote model inference is not covered by this release review.

## Research and verification

Official VERICUT, NCSIMUL and CAMplete documentation informs the workflow.
The implementation is original code, with no proprietary engine or assets.
See `research-ledger.json` for observed evidence and remaining unknowns.
The feature matrix explicitly distinguishes implemented, approximate and
unimplemented families, including actual RTCP, six-axis STEP CAM, multichannel
turn-mill synchronization, probing, metrology, force optimization and MES.

Tests check independent geometry oracles, arc handedness, kinematics, timing,
stock removal, alerts, density, STL signed volume/edges and cavity comparison.
Real Chrome tests cover Workers/WebGL/WASM, import/export, playback, invalidation,
cancellation and responsive layouts. All available legacy tests are repeated
in each review round. The UI and source tests are retained in the review source
package. New six-axis UI has no CDN runtime library or font dependency.

Serve via HTTP (ES modules/Workers cannot be run by opening file://). The demo
stock 80:50 is approximately 1.6:1; entered engineering dimensions take precedence.
Results are engineering previews, not actual FANUC controller qualification,
metrology certification or machine-run approval.
