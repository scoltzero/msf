// Adapted from Zephyruso/zashboard v3.18.0 under the MIT License.
// Copyright 2024 Zephyruso. See /THIRD_PARTY_NOTICES.md.
import backgroundTextureURL from '@/assets/images/earth/background.jpg'
import dayTextureURL from '@/assets/images/earth/earth-day.webp'
import nightTextureURL from '@/assets/images/earth/earth-night.webp'
import surfaceTextureURL from '@/assets/images/earth/earth-surface.webp'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js'
import {
  bumpMap,
  cameraPosition,
  color,
  float,
  max,
  mix,
  normalize,
  normalLocal,
  normalWorldGeometry,
  output,
  positionWorld,
  step,
  texture,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl'
import * as THREE from 'three/webgpu'
import type { EarthEndpointInfo, EarthHostTraffic, EarthLocation, EarthRoute } from './types'
import { MIHOMO_DOWNLOAD_COLOR, MIHOMO_UPLOAD_COLOR } from '../visualColors'

const EARTH_RADIUS = 1
// The bead sits partly below the surface so it reads as planted on the globe
// rather than floating above it; the globe's depth buffer clips the lower part.
const ENDPOINT_RADIUS = 1.005
const ENDPOINT_CORE_RADIUS = 0.011
const ENDPOINT_GLOW_RADIUS = 0.032
const ARC_SEGMENTS = 36
const MAX_INITIAL_LATITUDE = 15
const FLOW_DURATION_SECONDS = 0.85
const FLOW_STREAK_LENGTH = 0.14
const FLOW_STREAK_SEGMENTS = 14
const UPLOAD_COLOR = new THREE.Color(MIHOMO_UPLOAD_COLOR)
const DOWNLOAD_COLOR = new THREE.Color(MIHOMO_DOWNLOAD_COLOR)
const LINE_ORIGIN_COLOR = new THREE.Color('#b8f7ff')
const LINE_DESTINATION_COLOR = new THREE.Color('#4f9dff')
const ROLE_COLORS = {
  origin: new THREE.Color('#ffffff'),
  destination: new THREE.Color('#79d8ff'),
} as const
const ROLE_GLOW_COLORS = {
  origin: new THREE.Color('#a9e9ff'),
  destination: new THREE.Color('#3fa8ff'),
} as const
// The user's own location is the anchor of every arc, so it gets a slightly
// wider bead and halo than the destinations radiating out of it.
const ROLE_SCALES = {
  origin: 1.18,
  destination: 1,
} as const
const FLAT_GLOBE_PALETTES = {
  light: {
    ocean: '#dce6f0',
    land: '#65788d',
  },
  dark: {
    ocean: '#243241',
    land: '#8ca2b8',
  },
} as const

type EarthColorScheme = 'dark' | 'light'
type EarthVisualMode = 'flat' | 'space'

interface RendererOptions {
  reducedMotion: boolean
  visualMode: EarthVisualMode
  colorScheme: EarthColorScheme
  onEndpointHover: (info: EarthEndpointInfo | null, x?: number, y?: number) => void
}

interface RuntimeRoute {
  route: EarthRoute
  points: THREE.Vector3[]
}

interface EndpointRuntime extends EarthEndpointInfo {
  key: string
  position: THREE.Vector3
}

export interface EarthRenderer {
  setRoutes: (routes: EarthRoute[]) => void
  setInitialLocation: (location: EarthLocation) => void
  setReducedMotion: (reduced: boolean) => void
  setAutoRotation: (enabled: boolean) => void
  setVisualMode: (mode: EarthVisualMode) => void
  setColorScheme: (scheme: EarthColorScheme) => void
  dispose: () => void
}

const toVector = ({ latitude, longitude }: Pick<EarthLocation, 'latitude' | 'longitude'>) => {
  const latitudeRadians = THREE.MathUtils.degToRad(latitude)
  const longitudeRadians = THREE.MathUtils.degToRad(longitude)
  const cosLatitude = Math.cos(latitudeRadians)

  return new THREE.Vector3(
    cosLatitude * Math.cos(longitudeRadians),
    Math.sin(latitudeRadians),
    -cosLatitude * Math.sin(longitudeRadians),
  )
}

// NOAA's fractional-year approximation gives the current solar declination and
// equation of time. The resulting vector is expressed in the globe's local
// longitude/latitude coordinate system, so the day/night boundary stays attached
// to real geography even while the presentation group slowly rotates.
const getRealtimeSunDirection = (date = new Date(), target = new THREE.Vector3()) => {
  const year = date.getUTCFullYear()
  const startOfYear = Date.UTC(year, 0, 1)
  const startOfDay = Date.UTC(year, date.getUTCMonth(), date.getUTCDate())
  const dayOfYear = Math.floor((startOfDay - startOfYear) / 86_400_000) + 1
  const daysInYear = (Date.UTC(year + 1, 0, 1) - startOfYear) / 86_400_000
  const minutesUTC = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60
  const fractionalHour = minutesUTC / 60
  const gamma = (2 * Math.PI * (dayOfYear - 1 + (fractionalHour - 12) / 24)) / daysInYear
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma))
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)
  const longitude = THREE.MathUtils.degToRad((720 - minutesUTC - equationOfTime) / 4)
  const cosDeclination = Math.cos(declination)

  return target
    .set(
      cosDeclination * Math.cos(longitude),
      Math.sin(declination),
      -cosDeclination * Math.sin(longitude),
    )
    .normalize()
}

// Quaternion interpolation follows the shortest spherical path, including paths that
// cross ±180° longitude. It also has a deterministic antipodal fallback in three.js.
const greatCircle = (from: EarthLocation, to: EarthLocation) => {
  const start = toVector(from).normalize()
  const end = toVector(to).normalize()
  const rotation = new THREE.Quaternion().setFromUnitVectors(start, end)
  const identity = new THREE.Quaternion()
  const angle = Math.acos(THREE.MathUtils.clamp(start.dot(end), -1, 1))
  const height = 0.075 + Math.min(0.22, angle * 0.095)
  const points: THREE.Vector3[] = []

  for (let index = 0; index <= ARC_SEGMENTS; index += 1) {
    const progress = index / ARC_SEGMENTS
    const orientation = new THREE.Quaternion().slerpQuaternions(identity, rotation, progress)
    const radius = EARTH_RADIUS + Math.sin(Math.PI * progress) * height

    points.push(start.clone().applyQuaternion(orientation).normalize().multiplyScalar(radius))
  }

  return points
}

const samplePoints = (points: THREE.Vector3[], progress: number, target: THREE.Vector3) => {
  if (points.length === 0) return target.set(0, 0, 0)
  if (points.length === 1) return target.copy(points[0])

  const scaled = THREE.MathUtils.clamp(progress, 0, 1) * (points.length - 1)
  const index = Math.min(points.length - 2, Math.floor(scaled))

  return target.lerpVectors(points[index], points[index + 1], scaled - index)
}

const routeSignature = (routes: EarthRoute[]) =>
  routes
    .map(({ key }) => key)
    .sort()
    .join('|')

const mergeTopHosts = (...groups: EarthHostTraffic[][]) =>
  groups
    .flat()
    .sort((left, right) => right.downloaded - left.downloaded)
    .slice(0, 5)

export const createEarthRenderer = async (
  container: HTMLElement,
  options: RendererOptions,
): Promise<EarthRenderer> => {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
  camera.position.set(3.7, 1.55, 3.2)

  const renderer = new THREE.WebGPURenderer({ alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.domElement.className = 'h-full w-full cursor-grab active:cursor-grabbing'
  renderer.domElement.style.display = 'block'
  container.appendChild(renderer.domElement)

  try {
    await renderer.init()
  } catch (error) {
    renderer.dispose()
    renderer.domElement.remove()
    throw error
  }

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.enablePan = false
  controls.minDistance = 2.65
  controls.maxDistance = 7.5
  controls.rotateSpeed = 0.55
  controls.zoomSpeed = 0.75
  controls.touches.ONE = THREE.TOUCH.ROTATE
  controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE
  // Keep browser scrolling/navigation gestures inside the canvas from competing
  // with OrbitControls on touch devices.
  renderer.domElement.style.touchAction = 'none'

  const loader = new THREE.TextureLoader()
  let loadedTextures: [THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture]

  try {
    loadedTextures = await Promise.all([
      loader.loadAsync(backgroundTextureURL),
      loader.loadAsync(dayTextureURL),
      loader.loadAsync(nightTextureURL),
      loader.loadAsync(surfaceTextureURL),
    ])
  } catch (error) {
    controls.dispose()
    renderer.dispose()
    renderer.domElement.remove()
    throw error
  }

  const [backgroundTexture, dayTexture, nightTexture, surfaceTexture] = loadedTextures
  const textures = [backgroundTexture, dayTexture, nightTexture, surfaceTexture]

  backgroundTexture.mapping = THREE.EquirectangularReflectionMapping
  backgroundTexture.colorSpace = THREE.SRGBColorSpace
  dayTexture.colorSpace = THREE.SRGBColorSpace
  nightTexture.colorSpace = THREE.SRGBColorSpace
  dayTexture.anisotropy = 8
  nightTexture.anisotropy = 8
  surfaceTexture.anisotropy = 8
  scene.background = backgroundTexture

  const sun = new THREE.DirectionalLight('#ffffff', 2)
  sun.position.set(0, 0.25, 3)
  scene.add(sun)

  const atmosphereDayColor = uniform(color('#4db2ff'))
  const atmosphereTwilightColor = uniform(color('#bc490b'))
  const roughnessLow = uniform(0.25)
  const roughnessHigh = uniform(0.38)
  const sunDirection = uniform(getRealtimeSunDirection())
  const viewDirection = positionWorld.sub(cameraPosition).normalize()
  const fresnel = viewDirection.dot(normalWorldGeometry).abs().oneMinus().toVar()
  const sunOrientation = normalLocal.dot(normalize(sunDirection)).toVar()
  const atmosphereColor = mix(
    atmosphereTwilightColor,
    atmosphereDayColor,
    sunOrientation.smoothstep(-0.25, 0.75),
  )
  const cloudsStrength = texture(surfaceTexture, uv()).b.smoothstep(0.2, 1)
  const globeMaterial = new THREE.MeshStandardNodeMaterial()

  globeMaterial.colorNode = mix(texture(dayTexture), vec3(1), cloudsStrength.mul(2))
  globeMaterial.roughnessNode = max(texture(surfaceTexture).g, step(0.01, cloudsStrength)).remap(
    0,
    1,
    roughnessLow,
    roughnessHigh,
  )

  const night = texture(nightTexture)
  const dayStrength = sunOrientation.smoothstep(-0.25, 0.5)
  const atmosphereDayStrength = sunOrientation.smoothstep(-0.5, 1)
  const atmosphereMix = atmosphereDayStrength.mul(fresnel.pow(2)).clamp(0, 1)
  let finalOutput = mix(night.rgb, output.rgb, dayStrength)
  finalOutput = mix(finalOutput, atmosphereColor, atmosphereMix)
  globeMaterial.outputNode = vec4(finalOutput, output.a)
  globeMaterial.normalNode = bumpMap(max(texture(surfaceTexture).r, cloudsStrength))

  // The surface texture separates land (green channel) from water (blue channel),
  // which lets the flat renderer keep the same coastline without photo shading.
  const flatOceanColor = uniform(new THREE.Color())
  const flatLandColor = uniform(new THREE.Color())
  const flatSurface = texture(surfaceTexture, uv())
  const flatLandMask = flatSurface.g.sub(flatSurface.b).smoothstep(0.02, 0.16)
  const flatGlobeMaterial = new THREE.MeshBasicNodeMaterial()

  flatGlobeMaterial.colorNode = mix(flatOceanColor, flatLandColor, flatLandMask)
  flatGlobeMaterial.toneMapped = false

  const sphereGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 64, 64)
  const earthGroup = new THREE.Group()
  const globe = new THREE.Mesh<THREE.SphereGeometry, THREE.Material>(sphereGeometry, globeMaterial)
  earthGroup.add(globe)
  scene.add(earthGroup)

  const atmosphereMaterial = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  })
  let atmosphereAlpha = fresnel.remap(0.73, 1, 1, 0).pow(3)
  atmosphereAlpha = atmosphereAlpha.mul(sunOrientation.smoothstep(-0.5, 1))
  atmosphereMaterial.outputNode = vec4(atmosphereColor, atmosphereAlpha)
  const atmosphere = new THREE.Mesh(sphereGeometry, atmosphereMaterial)
  atmosphere.scale.setScalar(1.045)
  earthGroup.add(atmosphere)

  const syncSunLight = () => {
    sun.position.copy(sunDirection.value).applyQuaternion(earthGroup.quaternion).multiplyScalar(3)
  }
  const updateSunForTime = () => {
    getRealtimeSunDirection(new Date(), sunDirection.value)
    syncSunLight()
  }
  updateSunForTime()

  let lineGeometry = new LineSegmentsGeometry()
  const lineGlowMaterial = new THREE.Line2NodeMaterial({
    color: '#ffffff',
    linewidth: 5.5,
    transparent: true,
    opacity: 0.26,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const lineMaterial = new THREE.Line2NodeMaterial({
    color: '#ffffff',
    linewidth: 1.45,
    transparent: true,
    opacity: 0.96,
    vertexColors: true,
    depthWrite: false,
  })
  const lineGlow = new LineSegments2(lineGeometry, lineGlowMaterial)
  const lines = new LineSegments2(lineGeometry, lineMaterial)
  lineGlow.frustumCulled = false
  lines.frustumCulled = false
  // InstancedBufferGeometry defaults instanceCount to Infinity. Rendering the empty
  // placeholder before the first route snapshot makes WebGPU pass Infinity to
  // drawIndexed(), which is invalid. Only reveal it after finite segment data exists.
  lineGlow.visible = false
  lines.visible = false
  lineGlow.renderOrder = 1
  lines.renderOrder = 2
  earthGroup.add(lineGlow)
  earthGroup.add(lines)

  let flowGeometry = new LineSegmentsGeometry()
  const flowGlowMaterial = new THREE.Line2NodeMaterial({
    color: '#ffffff',
    linewidth: 9,
    transparent: true,
    opacity: 0.3,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const flowMaterial = new THREE.Line2NodeMaterial({
    color: '#ffffff',
    linewidth: 2.6,
    transparent: true,
    opacity: 0.96,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const flowGlow = new LineSegments2(flowGeometry, flowGlowMaterial)
  const flows = new LineSegments2(flowGeometry, flowMaterial)
  flowGlow.frustumCulled = false
  flows.frustumCulled = false
  flowGlow.visible = false
  flows.visible = false
  flowGlow.renderOrder = 3
  flows.renderOrder = 4
  earthGroup.add(flowGlow)
  earthGroup.add(flows)

  // Endpoints are unlit beads, so their volume has to be faked in the shader:
  // `facing` is 1 at the point of the sphere aimed straight at the camera and 0
  // along the silhouette, which drives both the specular-like hot core and the
  // rim light that separates the bead from the globe behind it.
  const endpointPulse = uniform(1)
  const endpointFacing = positionWorld
    .sub(cameraPosition)
    .normalize()
    .dot(normalWorldGeometry)
    .abs()
    .toVar()
  const endpointSunOrientation = normalLocal.dot(normalize(sunDirection))
  const endpointShade = float(0.7).add(endpointSunOrientation.smoothstep(-0.7, 0.9).mul(0.5))
  const endpointRim = endpointFacing.oneMinus().pow(2.6).mul(0.85)
  const endpointHotCore = endpointFacing.pow(8).mul(0.5)
  const endpointGeometry = new THREE.SphereGeometry(ENDPOINT_CORE_RADIUS, 12, 8)
  const endpointMaterial = new THREE.MeshBasicNodeMaterial()
  const flatEndpointMaterial = new THREE.MeshBasicNodeMaterial()

  endpointMaterial.outputNode = vec4(
    output.rgb
      .mul(endpointShade.add(endpointRim))
      .add(mix(output.rgb, vec3(1), 0.65).mul(endpointHotCore)),
    output.a,
  )

  // A halo shell around each bead. Combining a wide and a tight falloff in one
  // shader gives a dense centre that fades out smoothly, without a second mesh.
  // Where the shell sinks into the globe the alpha is already near zero, so the
  // depth-buffer cut stays invisible except at grazing angles.
  const endpointGlowGeometry = new THREE.SphereGeometry(ENDPOINT_GLOW_RADIUS, 16, 12)
  const endpointGlowMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  endpointGlowMaterial.outputNode = vec4(
    output.rgb,
    endpointFacing
      .pow(2.4)
      .mul(0.34)
      .add(endpointFacing.pow(9).mul(0.5))
      .mul(endpointPulse)
      .clamp(0, 1),
  )

  let endpointMesh: THREE.InstancedMesh | null = null
  let endpointGlowMesh: THREE.InstancedMesh | null = null
  let endpointRuntime: EndpointRuntime[] = []
  let runtimeRoutes: RuntimeRoute[] = []
  let currentSignature = ''
  let reducedMotion = options.reducedMotion
  let visualMode = options.visualMode
  let colorScheme = options.colorScheme
  let autoRotation = true
  let initialLocationSet = false
  let disposed = false
  let visible = !document.hidden
  let intersecting = true
  let pinnedEndpoint = false
  let pulseTime = 0
  const flowProgress = new Map<string, number>()
  let flowPositions = new Float32Array(0)
  let flowColors = new Float32Array(0)
  let flowPositionBuffer: THREE.InterleavedBuffer | null = null
  let flowColorBuffer: THREE.InterleavedBuffer | null = null
  const matrix = new THREE.Matrix4()
  const endpointRotation = new THREE.Quaternion()
  const endpointScale = new THREE.Vector3()
  const flowStart = new THREE.Vector3()
  const flowEnd = new THREE.Vector3()
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const clock = new THREE.Clock()

  const applyColorScheme = () => {
    const palette = FLAT_GLOBE_PALETTES[colorScheme]

    flatOceanColor.value.set(palette.ocean)
    flatLandColor.value.set(palette.land)
  }

  const applyVisualMode = () => {
    const flat = visualMode === 'flat'

    scene.background = flat ? null : backgroundTexture
    renderer.toneMapping = flat ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping
    globe.material = flat ? flatGlobeMaterial : globeMaterial
    sun.visible = !flat
    atmosphere.visible = !flat
    lineGlow.visible = !flat && lines.visible
    flowGlow.visible = !flat && flows.visible
    if (endpointMesh) endpointMesh.material = flat ? flatEndpointMaterial : endpointMaterial
    if (endpointGlowMesh) endpointGlowMesh.visible = !flat
    flowMaterial.blending = flat ? THREE.NormalBlending : THREE.AdditiveBlending
    flowMaterial.needsUpdate = true
  }

  applyColorScheme()
  applyVisualMode()

  const render = () => {
    if (!disposed && visible && intersecting) renderer.render(scene, camera)
  }

  const updateFlows = (delta: number, advance: boolean) => {
    if (flowPositions.length === 0) return

    let flowSegmentIndex = 0

    for (const runtime of runtimeRoutes) {
      for (const direction of ['upload', 'download'] as const) {
        const rate = runtime.route[direction]
        const progressKey = `${runtime.route.key}:${direction}`
        let progress = flowProgress.get(progressKey) ?? 0

        if (rate <= 0) continue

        if (advance) {
          progress = Math.min(
            1 + FLOW_STREAK_LENGTH,
            progress + (delta * (1 + FLOW_STREAK_LENGTH)) / FLOW_DURATION_SECONDS,
          )
        }
        flowProgress.set(progressKey, progress)

        const trailStart = Math.max(0, progress - FLOW_STREAK_LENGTH)
        const trailEnd = Math.min(1, progress)
        const visibleLength = trailEnd - trailStart
        if (visibleLength <= 0) continue

        const segmentCount = Math.max(
          1,
          Math.ceil((visibleLength / FLOW_STREAK_LENGTH) * FLOW_STREAK_SEGMENTS),
        )
        const color = direction === 'upload' ? UPLOAD_COLOR : DOWNLOAD_COLOR
        const tailColor = color.clone().multiplyScalar(0.32)

        for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
          const startRatio = segmentIndex / segmentCount
          const endRatio = (segmentIndex + 1) / segmentCount
          const startProgress = THREE.MathUtils.lerp(trailStart, trailEnd, startRatio)
          const endProgress = THREE.MathUtils.lerp(trailStart, trailEnd, endRatio)
          samplePoints(
            runtime.points,
            direction === 'download' ? 1 - startProgress : startProgress,
            flowStart,
          )
          samplePoints(
            runtime.points,
            direction === 'download' ? 1 - endProgress : endProgress,
            flowEnd,
          )

          const offset = flowSegmentIndex * 6
          flowPositions[offset] = flowStart.x
          flowPositions[offset + 1] = flowStart.y
          flowPositions[offset + 2] = flowStart.z
          flowPositions[offset + 3] = flowEnd.x
          flowPositions[offset + 4] = flowEnd.y
          flowPositions[offset + 5] = flowEnd.z
          const startStrength = 0.06 + Math.pow(startRatio, 1.7) * 0.94
          const endStrength = 0.06 + Math.pow(endRatio, 1.7) * 0.94
          flowColors[offset] = THREE.MathUtils.lerp(tailColor.r, color.r, startStrength)
          flowColors[offset + 1] = THREE.MathUtils.lerp(tailColor.g, color.g, startStrength)
          flowColors[offset + 2] = THREE.MathUtils.lerp(tailColor.b, color.b, startStrength)
          flowColors[offset + 3] = THREE.MathUtils.lerp(tailColor.r, color.r, endStrength)
          flowColors[offset + 4] = THREE.MathUtils.lerp(tailColor.g, color.g, endStrength)
          flowColors[offset + 5] = THREE.MathUtils.lerp(tailColor.b, color.b, endStrength)
          flowSegmentIndex += 1
        }
      }
    }

    flowGeometry.instanceCount = flowSegmentIndex
    flowGlow.visible = visualMode === 'space' && flowSegmentIndex > 0
    flows.visible = flowSegmentIndex > 0
    if (flowPositionBuffer) flowPositionBuffer.needsUpdate = true
    if (flowColorBuffer) flowColorBuffer.needsUpdate = true
  }

  const animate = () => {
    if (disposed) return

    const elapsed = clock.getDelta()
    const delta = Math.min(0.05, elapsed)
    if (autoRotation) earthGroup.rotation.y += delta * 0.025
    pulseTime += delta
    endpointPulse.value = 0.82 + Math.sin(pulseTime * 2.1) * 0.18
    if (visualMode === 'space') syncSunLight()
    controls.update(delta)
    updateFlows(elapsed, true)

    render()
  }

  const updateAnimationLoop = () => {
    renderer.setAnimationLoop(null)
    clock.stop()

    if (!visible || !intersecting || disposed) return

    if (visualMode === 'space') updateSunForTime()

    if (reducedMotion) {
      controls.enableDamping = false
      render()
    } else {
      controls.enableDamping = true
      clock.start()
      renderer.setAnimationLoop(animate)
    }
  }

  const rebuildEndpoints = (routes: EarthRoute[]) => {
    if (endpointMesh) {
      earthGroup.remove(endpointMesh)
      endpointMesh.dispose()
    }
    if (endpointGlowMesh) {
      earthGroup.remove(endpointGlowMesh)
      endpointGlowMesh.dispose()
    }

    const endpoints = new Map<string, EndpointRuntime>()

    for (const route of routes) {
      for (const point of route.path) {
        const key = `${point.role}:${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`
        const existing = endpoints.get(key)

        if (existing) {
          existing.connections += route.connections
          if (point.role === 'destination') {
            existing.topHosts = mergeTopHosts(existing.topHosts, route.topHosts)
          }
        } else {
          endpoints.set(key, {
            key,
            city: point.city,
            country: point.country,
            role: point.role,
            connections: route.connections,
            topHosts: point.role === 'destination' ? route.topHosts : [],
            position: toVector(point).multiplyScalar(ENDPOINT_RADIUS),
          })
        }
      }
    }

    endpointRuntime = [...endpoints.values()]
    const capacity = Math.max(1, endpointRuntime.length)
    endpointMesh = new THREE.InstancedMesh(
      endpointGeometry,
      visualMode === 'flat' ? flatEndpointMaterial : endpointMaterial,
      capacity,
    )
    endpointGlowMesh = new THREE.InstancedMesh(endpointGlowGeometry, endpointGlowMaterial, capacity)
    endpointMesh.count = endpointRuntime.length
    endpointGlowMesh.count = endpointRuntime.length
    endpointGlowMesh.visible = visualMode === 'space'
    endpointRotation.identity()

    for (let index = 0; index < endpointRuntime.length; index += 1) {
      const endpoint = endpointRuntime[index]
      const scale = ROLE_SCALES[endpoint.role]

      matrix.compose(endpoint.position, endpointRotation, endpointScale.setScalar(scale))
      endpointMesh.setMatrixAt(index, matrix)
      endpointGlowMesh.setMatrixAt(index, matrix)
      endpointMesh.setColorAt(index, ROLE_COLORS[endpoint.role])
      endpointGlowMesh.setColorAt(index, ROLE_GLOW_COLORS[endpoint.role])
    }

    endpointMesh.instanceMatrix.needsUpdate = true
    endpointGlowMesh.instanceMatrix.needsUpdate = true
    if (endpointMesh.instanceColor) endpointMesh.instanceColor.needsUpdate = true
    if (endpointGlowMesh.instanceColor) endpointGlowMesh.instanceColor.needsUpdate = true
    // Draw the beads above the arcs and the halos last, so the additive glow
    // blends over everything already on screen.
    endpointMesh.renderOrder = 5
    endpointGlowMesh.renderOrder = 6
    earthGroup.add(endpointMesh)
    earthGroup.add(endpointGlowMesh)
  }

  const refreshEndpointCounts = (routes: EarthRoute[]) => {
    const endpointInfo = new Map<
      string,
      Pick<EarthEndpointInfo, 'city' | 'country' | 'connections' | 'topHosts'>
    >()

    for (const route of routes) {
      for (const point of route.path) {
        const key = `${point.role}:${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`
        const existing = endpointInfo.get(key)

        if (existing) {
          existing.connections += route.connections
          if (point.role === 'destination') {
            existing.topHosts = mergeTopHosts(existing.topHosts, route.topHosts)
          }
        } else {
          endpointInfo.set(key, {
            city: point.city,
            country: point.country,
            connections: route.connections,
            topHosts: point.role === 'destination' ? route.topHosts : [],
          })
        }
      }
    }

    for (const endpoint of endpointRuntime) {
      const info = endpointInfo.get(endpoint.key)

      if (info) Object.assign(endpoint, info)
    }
  }

  const rebuildGeometry = (routes: EarthRoute[]) => {
    const positions: number[] = []
    const colors: number[] = []
    runtimeRoutes = []

    for (const route of routes) {
      const routePoints: THREE.Vector3[] = []

      for (let pathIndex = 0; pathIndex < route.path.length - 1; pathIndex += 1) {
        const from = route.path[pathIndex]
        const to = route.path[pathIndex + 1]
        const arc = greatCircle(from, to)

        routePoints.push(...(routePoints.length > 0 ? arc.slice(1) : arc))

        for (let pointIndex = 0; pointIndex < arc.length - 1; pointIndex += 1) {
          const start = arc[pointIndex]
          const end = arc[pointIndex + 1]
          const startProgress = pointIndex / (arc.length - 1)
          const endProgress = (pointIndex + 1) / (arc.length - 1)
          positions.push(start.x, start.y, start.z, end.x, end.y, end.z)
          colors.push(
            THREE.MathUtils.lerp(LINE_ORIGIN_COLOR.r, LINE_DESTINATION_COLOR.r, startProgress),
            THREE.MathUtils.lerp(LINE_ORIGIN_COLOR.g, LINE_DESTINATION_COLOR.g, startProgress),
            THREE.MathUtils.lerp(LINE_ORIGIN_COLOR.b, LINE_DESTINATION_COLOR.b, startProgress),
            THREE.MathUtils.lerp(LINE_ORIGIN_COLOR.r, LINE_DESTINATION_COLOR.r, endProgress),
            THREE.MathUtils.lerp(LINE_ORIGIN_COLOR.g, LINE_DESTINATION_COLOR.g, endProgress),
            THREE.MathUtils.lerp(LINE_ORIGIN_COLOR.b, LINE_DESTINATION_COLOR.b, endProgress),
          )
        }
      }

      runtimeRoutes.push({ route, points: routePoints })
    }

    const previousGeometry = lineGeometry
    lineGeometry = new LineSegmentsGeometry()

    if (positions.length > 0) {
      lineGeometry.setPositions(positions)
      lineGeometry.setColors(colors)
      lineGlow.visible = visualMode === 'space'
      lines.visible = true
    } else {
      lineGlow.visible = false
      lines.visible = false
    }

    lineGlow.geometry = lineGeometry
    lines.geometry = lineGeometry
    previousGeometry.dispose()
    rebuildEndpoints(routes)

    const previousFlowGeometry = flowGeometry
    const flowCapacity = Math.max(1, runtimeRoutes.length * 2 * FLOW_STREAK_SEGMENTS)
    flowPositions = new Float32Array(flowCapacity * 6)
    flowColors = new Float32Array(flowCapacity * 6)
    flowGeometry = new LineSegmentsGeometry()
    flowGeometry.setPositions(flowPositions)
    flowGeometry.setColors(flowColors)
    flowPositionBuffer = (
      flowGeometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute
    ).data
    flowColorBuffer = (
      flowGeometry.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute
    ).data
    flowPositionBuffer.setUsage(THREE.DynamicDrawUsage)
    flowColorBuffer.setUsage(THREE.DynamicDrawUsage)
    flowGeometry.instanceCount = 0
    flowGlow.geometry = flowGeometry
    flows.geometry = flowGeometry
    previousFlowGeometry.dispose()
  }

  const setRoutes = (incomingRoutes: EarthRoute[]) => {
    const routes = [...incomingRoutes].sort((left, right) => left.key.localeCompare(right.key))
    const signature = routeSignature(routes)

    if (signature !== currentSignature) {
      currentSignature = signature
      rebuildGeometry(routes)
    } else {
      const nextByKey = new Map(routes.map((route) => [route.key, route]))

      for (const runtime of runtimeRoutes) {
        const next = nextByKey.get(runtime.route.key)
        if (next) runtime.route = next
      }
      refreshEndpointCounts(routes)
    }

    flowProgress.clear()
    for (const route of routes) {
      if (route.upload > 0) flowProgress.set(`${route.key}:upload`, 0)
      if (route.download > 0) flowProgress.set(`${route.key}:download`, 0)
    }
    updateFlows(0, false)
    if (reducedMotion) render()
  }

  const hitTestEndpoint = (event: PointerEvent) => {
    if (!endpointGlowMesh || endpointRuntime.length === 0) return null

    const bounds = renderer.domElement.getBoundingClientRect()
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    // The halo shares the bead's instance order and is a far easier target to
    // hit than the core.
    const hit = raycaster.intersectObject(endpointGlowMesh, false)[0]

    if (hit?.instanceId == null) return null
    return endpointRuntime[hit.instanceId] ?? null
  }

  const showEndpoint = (event: PointerEvent, pin = false) => {
    const endpoint = hitTestEndpoint(event)

    if (endpoint) {
      pinnedEndpoint = pin
      options.onEndpointHover(endpoint, event.clientX, event.clientY)
      renderer.domElement.style.cursor = 'pointer'
    } else if (!pinnedEndpoint || pin) {
      pinnedEndpoint = false
      options.onEndpointHover(null)
      renderer.domElement.style.cursor = ''
    }
  }
  const onPointerMove = (event: PointerEvent) => {
    if (!pinnedEndpoint && event.pointerType !== 'touch') showEndpoint(event)
  }
  const onClick = (event: PointerEvent) => showEndpoint(event, true)
  const onPointerLeave = () => {
    if (!pinnedEndpoint) options.onEndpointHover(null)
  }
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('click', onClick)
  renderer.domElement.addEventListener('pointerleave', onPointerLeave)

  const resizeObserver = new ResizeObserver(([entry]) => {
    const width = Math.max(1, entry.contentRect.width)
    const height = Math.max(1, entry.contentRect.height)

    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    render()
  })
  resizeObserver.observe(container)

  const intersectionObserver = new IntersectionObserver(
    ([entry]) => {
      intersecting = entry.isIntersecting
      updateAnimationLoop()
    },
    { threshold: 0.01 },
  )
  intersectionObserver.observe(container)

  const onVisibilityChange = () => {
    visible = !document.hidden
    updateAnimationLoop()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  const sunTimer = window.setInterval(() => {
    if (visualMode === 'space') updateSunForTime()
    if (reducedMotion) render()
  }, 60_000)
  const onControlsChange = () => {
    if (reducedMotion) render()
  }
  controls.addEventListener('change', onControlsChange)
  updateAnimationLoop()

  return {
    setRoutes,
    setInitialLocation(location) {
      if (
        initialLocationSet ||
        !Number.isFinite(location.latitude) ||
        !Number.isFinite(location.longitude)
      ) {
        return
      }

      initialLocationSet = true
      const distance = camera.position.distanceTo(controls.target)
      const direction = toVector({
        latitude: THREE.MathUtils.clamp(
          location.latitude,
          -MAX_INITIAL_LATITUDE,
          MAX_INITIAL_LATITUDE,
        ),
        longitude: location.longitude,
      })
        .applyQuaternion(earthGroup.quaternion)
        .normalize()
      camera.position.copy(controls.target).addScaledVector(direction, distance)
      controls.update()
      render()
    },
    setReducedMotion(value) {
      reducedMotion = value
      updateAnimationLoop()
    },
    setAutoRotation(enabled) {
      autoRotation = enabled
    },
    setVisualMode(mode) {
      if (visualMode === mode) return
      visualMode = mode
      applyVisualMode()
      render()
    },
    setColorScheme(scheme) {
      if (colorScheme === scheme) return
      colorScheme = scheme
      applyColorScheme()
      if (visualMode === 'flat') render()
    },
    dispose() {
      if (disposed) return
      disposed = true
      renderer.setAnimationLoop(null)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      window.clearInterval(sunTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('click', onClick)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      controls.removeEventListener('change', onControlsChange)
      controls.dispose()
      lineGeometry.dispose()
      lineGlowMaterial.dispose()
      lineMaterial.dispose()
      flowGeometry.dispose()
      flowGlowMaterial.dispose()
      flowMaterial.dispose()
      endpointMesh?.dispose()
      endpointGlowMesh?.dispose()
      endpointGeometry.dispose()
      endpointGlowGeometry.dispose()
      endpointMaterial.dispose()
      flatEndpointMaterial.dispose()
      endpointGlowMaterial.dispose()
      sphereGeometry.dispose()
      globeMaterial.dispose()
      flatGlobeMaterial.dispose()
      atmosphereMaterial.dispose()
      textures.forEach((item) => item.dispose())
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
