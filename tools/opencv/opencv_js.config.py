# Bindings whitelist for this project's custom OpenCV.js build.
#
# Derived from OpenCV's own platforms/js/opencv_js.config.py, cut down to the
# two modules the screenshot reader actually uses: core and imgproc. The
# upstream file also whitelists objdetect, video, dnn, features2d, photo and
# calib3d; every one of those is a module we never call, and each one it
# whitelists is a module that has to be compiled in.
#
# embindgen.py exec()s this file in its own namespace, so makeWhiteList is in
# scope here without an import. Keep the module dicts verbatim from upstream
# when regenerating for a new OpenCV version — the only intended difference is
# which modules reach the final makeWhiteList call.
core = {
    '': [
        'absdiff', 'add', 'addWeighted', 'bitwise_and', 'bitwise_not', 'bitwise_or', 'bitwise_xor', 'cartToPolar',
        'compare', 'convertScaleAbs', 'copyMakeBorder', 'countNonZero', 'determinant', 'dft', 'divide', 'eigen',
        'exp', 'flip', 'getOptimalDFTSize','gemm', 'hconcat', 'inRange', 'invert', 'kmeans', 'log', 'magnitude',
        'max', 'mean', 'meanStdDev', 'merge', 'min', 'minMaxLoc', 'mixChannels', 'multiply', 'norm', 'normalize',
        'perspectiveTransform', 'polarToCart', 'pow', 'randn', 'randu', 'reduce', 'repeat', 'rotate', 'setIdentity', 'setRNGSeed',
        'solve', 'solvePoly', 'split', 'sqrt', 'subtract', 'trace', 'transform', 'transpose', 'vconcat',
        'setLogLevel', 'getLogLevel',
        'LUT',
    ],
    'Algorithm': [],
}

imgproc = {
    '': [
        'Canny',
        'GaussianBlur',
        'Laplacian',
        'HoughLines',
        'HoughLinesP',
        'HoughCircles',
        'Scharr',
        'Sobel',
        'adaptiveThreshold',
        'approxPolyDP',
        'arcLength',
        'bilateralFilter',
        'blur',
        'boundingRect',
        'boxFilter',
        'calcBackProject',
        'calcHist',
        'circle',
        'compareHist',
        'connectedComponents',
        'connectedComponentsWithStats',
        'contourArea',
        'convexHull',
        'convexityDefects',
        'cornerHarris',
        'cornerMinEigenVal',
        'createCLAHE',
        'createLineSegmentDetector',
        'cvtColor',
        'demosaicing',
        'dilate',
        'distanceTransform',
        'distanceTransformWithLabels',
        'drawContours',
        'ellipse',
        'ellipse2Poly',
        'equalizeHist',
        'erode',
        'filter2D',
        'findContours',
        'fitEllipse',
        'fitLine',
        'floodFill',
        'getAffineTransform',
        'getPerspectiveTransform',
        'getRotationMatrix2D',
        'getStructuringElement',
        'goodFeaturesToTrack',
        'grabCut',
        #'initUndistortRectifyMap',  # 4.x: moved to calib3d
        'integral',
        'integral2',
        'isContourConvex',
        'line',
        'matchShapes',
        'matchTemplate',
        'medianBlur',
        'minAreaRect',
        'minEnclosingCircle',
        'moments',
        'morphologyEx',
        'pointPolygonTest',
        'putText',
        'pyrDown',
        'pyrUp',
        'rectangle',
        'remap',
        'resize',
        'sepFilter2D',
        'threshold',
        #'undistort',  # 4.x: moved to calib3d
        'warpAffine',
        'warpPerspective',
        'warpPolar',
        'watershed',
        'fillPoly',
        'fillConvexPoly',
        'polylines',
    ],
    'CLAHE': ['apply', 'collectGarbage', 'getClipLimit', 'getTilesGridSize', 'setClipLimit', 'setTilesGridSize'],
    'segmentation_IntelligentScissorsMB': [
        'IntelligentScissorsMB',
        'setWeights',
        'setGradientMagnitudeMaxLimit',
        'setEdgeFeatureZeroCrossingParameters',
        'setEdgeFeatureCannyParameters',
        'applyImage',
        'applyImageFeatures',
        'buildMap',
        'getContour'
    ],
}


white_list = makeWhiteList([core, imgproc])
