#include "timeline_easing.h"

#include <algorithm>
#include <cmath>

namespace playoutd {

namespace {

double clamp01(double t) {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

double easePower2In(double t) {
  return t * t;
}

double easePower2Out(double t) {
  const double inv = 1.0 - t;
  return 1.0 - inv * inv;
}

double easeBounceOut(double t) {
  constexpr double n1 = 7.5625;
  constexpr double d1 = 2.75;
  if (t < 1.0 / d1) return n1 * t * t;
  if (t < 2.0 / d1) {
    t -= 1.5 / d1;
    return n1 * t * t + 0.75;
  }
  if (t < 2.5 / d1) {
    t -= 2.25 / d1;
    return n1 * t * t + 0.9375;
  }
  t -= 2.625 / d1;
  return n1 * t * t + 0.984375;
}

double easeElasticOut(double t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  constexpr double c4 = (2.0 * M_PI) / 3.0;
  return std::pow(2.0, -10.0 * t) * std::sin((t * 10.0 - 0.75) * c4) + 1.0;
}

} // namespace

double cubicBezierY(double t, const BezierSnap& cp) {
  t = clamp01(t);
  const double cx = 3.0 * cp.cp1x;
  const double bx = 3.0 * (cp.cp2x - cp.cp1x) - cx;
  const double ax = 1.0 - cx - bx;
  const double cy = 3.0 * cp.cp1y;
  const double by = 3.0 * (cp.cp2y - cp.cp1y) - cy;
  const double ay = 1.0 - cy - by;

  auto sampleX = [&](double u) { return ((ax * u + bx) * u + cx) * u; };
  auto sampleY = [&](double u) { return ((ay * u + by) * u + cy) * u; };

  double lo = 0;
  double hi = 1;
  for (int i = 0; i < 12; ++i) {
    const double mid = (lo + hi) * 0.5;
    if (sampleX(mid) < t) lo = mid;
    else hi = mid;
  }
  return sampleY((lo + hi) * 0.5);
}

double applySegmentEase(double t, const std::string& easing, const BezierSnap* bezier) {
  t = clamp01(t);
  if (bezier && bezier->valid) return cubicBezierY(t, *bezier);
  if (easing.empty() || easing == "linear") return t;
  if (easing == "power2.in") return easePower2In(t);
  if (easing == "power2.out") return easePower2Out(t);
  if (easing == "bounce.out") return easeBounceOut(t);
  if (easing == "elastic.out") return easeElasticOut(t);
  return t;
}

} // namespace playoutd
