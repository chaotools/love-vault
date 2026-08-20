// 放射关系图的圆环半径。所有半径均以 CSS 像素表示，并预留节点和文字标签空间，
// 因此在窄屏上也不会把最外层节点排到画布之外。
export function radialRingRadii(width, height, directCount = 0, extendedCount = 0) {
  const minSide = Math.max(0, Math.min(Number(width) || 0, Number(height) || 0));
  // 圆点半径约 24px，标签另需约 24px；两侧各留出 48px 安全边距。
  const maxRadius = Math.max(0, minSide / 2 - 48);
  const direct = Math.max(0, Number(directCount) || 0);
  const extended = Math.max(0, Number(extendedCount) || 0);
  const crowdRadius = (count) => Math.min(maxRadius, count * 48 / (Math.PI * 2));
  const soloRadius = (count) => Math.min(maxRadius, Math.max(Math.min(72, maxRadius), crowdRadius(count)));

  if (direct && extended) {
    // 双层时内圈最多占可用半径的 58%，外圈永远是安全半径。
    const directRadius = Math.min(
      maxRadius * 0.58,
      Math.max(Math.min(56, maxRadius * 0.58), crowdRadius(direct))
    );
    return { directRadius, extendedRadius: maxRadius, maxRadius };
  }
  if (direct) return { directRadius: soloRadius(direct), extendedRadius: 0, maxRadius };
  if (extended) return { directRadius: 0, extendedRadius: soloRadius(extended), maxRadius };
  return { directRadius: 0, extendedRadius: 0, maxRadius };
}
