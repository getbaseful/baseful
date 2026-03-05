import { useMemo } from 'react';

// 8x8 Bayer Matrix, normalized to values between 0 and 1
const BAYER_MATRIX = [
    [0, 48, 12, 60, 3, 51, 15, 63],
    [32, 16, 44, 28, 35, 19, 47, 31],
    [8, 56, 4, 52, 11, 59, 7, 55],
    [40, 24, 36, 20, 43, 27, 39, 23],
    [2, 50, 14, 62, 1, 49, 13, 61],
    [34, 18, 46, 30, 33, 17, 45, 29],
    [10, 58, 6, 54, 9, 57, 5, 53],
    [42, 26, 38, 22, 41, 25, 37, 21]
].map(row => row.map(v => (v + 0.5) / 64));

const hashString = (str: string) => {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return hash >>> 0;
};

const createPRNG = (seed: number) => {
    let currentSeed = seed || 1;
    return function () {
        currentSeed = (currentSeed * 16807) % 2147483647;
        return (currentSeed - 1) / 2147483646;
    };
};

export const DitherAvatar = ({
    value = "",
    size = 40,
    // Lowered default grid resolution so the blocks are larger and visibly chunky
    gridRes = 16,
    className = ""
}) => {

    const { bg, rects } = useMemo(() => {
        const seed = hashString(value);
        const rnd = createPRNG(seed);

        const baseHue = rnd() * 360;

        // INCREASED CONTRAST:
        // Pushed background lightness much deeper (15%)
        const bg = `hsl(${baseHue}, 90%, 15%)`;
        // Pushed foreground lightness much higher (80%)
        const fg = `hsl(${baseHue + (rnd() * 40 - 20)}, 100%, 80%)`;

        const angle = rnd() * Math.PI * 2;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        const generatedRects = [];
        const center = gridRes / 2;
        const maxDist = (gridRes / 2) * Math.sqrt(2);

        for (let y = 0; y < gridRes; y++) {
            for (let x = 0; x < gridRes; x++) {
                const dx = x - center;
                const dy = y - center;
                const dotProduct = dx * cosA + dy * sinA;

                // Base mapping to $0 - 1$
                let gradientValue = (dotProduct + maxDist) / (maxDist * 2);

                // OPTIONAL SHARPNESS TWEAK: 
                // Compressing the gradient slightly increases the "dither band" visibility
                const contrastMultiplier = 1.2;
                gradientValue = ((gradientValue - 0.5) * contrastMultiplier) + 0.5;

                const threshold = BAYER_MATRIX[y % 8][x % 8];

                if (gradientValue > threshold) {
                    generatedRects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fg} />);
                }
            }
        }

        return { bg, fg, rects: generatedRects };
    }, [value, gridRes]);

    return (
        <div
            className={`${className} inline-block`}
            style={{
                width: size,
                height: size,
                borderRadius: '6px',
                overflow: 'hidden',
            }}
        >
            <svg
                viewBox={`0 0 ${gridRes} ${gridRes}`}
                width="100%"
                height="100%"
                // PREVENTS BLURRING: Tells the browser not to anti-alias the grid pixels
                shapeRendering="crispEdges"
                style={{ display: 'block', backgroundColor: bg }}
            >
                {rects}
            </svg>
        </div>
    );
};