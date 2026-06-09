#pragma once

#include "timeline_native.h"

namespace playoutd {

double cubicBezierY(double t, const BezierSnap& cp);
double applySegmentEase(double t, const std::string& easing, const BezierSnap* bezier);

} // namespace playoutd
