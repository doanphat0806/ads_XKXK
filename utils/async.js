async function mapInBatches(items, batchSize, iteratee) {
  const results = [];
  const safeBatchSize = Math.max(1, Number(batchSize) || 1);

  for (let i = 0; i < items.length; i += safeBatchSize) {
    const chunk = items.slice(i, i + safeBatchSize);
    const settled = await Promise.allSettled(chunk.map(iteratee));
    results.push(...settled);
  }

  return results;
}

module.exports = {
  mapInBatches
};
