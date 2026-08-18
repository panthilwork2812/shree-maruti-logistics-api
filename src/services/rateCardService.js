const localRateCard = require('../data/rateCard.json');

class RateCardService {
  /**
   * Normalizes zone names to match key names in rate card
   */
  getRateKeyForZone(zone) {
    const cleanZone = (zone || '').toLowerCase();
    if (cleanZone.includes('local')) return 'local';
    if (cleanZone.includes('within') || cleanZone.includes('state')) return 'withinZone';
    if (cleanZone.includes('metro')) return 'metro';
    if (cleanZone.includes('special')) return 'specialZone';
    return 'roi';
  }

  /**
   * Calculate Shipping Cost based on Mode, Chargeable Weight, Zone, and Rate Card dataset
   */
  calculateFreightRate(mode, weight, zone, rateCardDataset = null) {
    const rateCard = rateCardDataset || localRateCard;
    const cleanMode = (mode || 'Surface').toLowerCase();
    const zoneKey = this.getRateKeyForZone(zone);

    // Filter rate card by mode
    const modeRates = rateCard.filter(r => r.mode.toLowerCase() === cleanMode);
    if (!modeRates || modeRates.length === 0) {
      throw new Error(`No rate card found for mode: ${mode}`);
    }

    // Fixed Slabs sorted by slabTo ascending
    const fixedSlabs = modeRates
      .filter(r => r.slabType === 'Fixed' && r.slabTo !== null)
      .sort((a, b) => a.slabTo - b.slabTo);

    // Per KG Additional Rate Slab
    const addPerKgSlab = modeRates.find(r => r.slabType === 'Add Per KG');

    // 1. Check if weight falls within a fixed slab
    for (const slab of fixedSlabs) {
      if (weight > slab.slabFrom && weight <= slab.slabTo) {
        const cost = slab[zoneKey] || 0;
        return {
          slabType: 'Fixed',
          slabRange: `${slab.slabFrom} - ${slab.slabTo} KG`,
          baseCost: cost,
          additionalCost: 0,
          totalCost: cost
        };
      }
    }

    // 2. If weight exceeds maximum fixed slab
    if (fixedSlabs.length > 0 && addPerKgSlab) {
      const maxFixedSlab = fixedSlabs[fixedSlabs.length - 1];
      const maxFixedWeight = maxFixedSlab.slabTo;

      if (weight > maxFixedWeight) {
        const baseCost = maxFixedSlab[zoneKey] || 0;
        const extraWeight = weight - maxFixedWeight;

        // Logistics rule: Round up extra weight to nearest 1 kg slab
        const extraKgUnits = Math.ceil(extraWeight);
        const perKgRate = addPerKgSlab[zoneKey] || 0;
        const additionalCost = extraKgUnits * perKgRate;
        const totalCost = baseCost + additionalCost;

        return {
          slabType: 'Fixed + Add Per KG',
          slabRange: `Base (${maxFixedWeight} KG) + Extra (${extraKgUnits} KG @ ₹${perKgRate}/kg)`,
          baseCost,
          additionalCost,
          totalCost
        };
      }
    }

    // Fallback for edge cases (e.g. 0 kg or exact boundary)
    if (fixedSlabs.length > 0) {
      const minSlab = fixedSlabs[0];
      return {
        slabType: 'Fixed',
        slabRange: `${minSlab.slabFrom} - ${minSlab.slabTo} KG`,
        baseCost: minSlab[zoneKey],
        additionalCost: 0,
        totalCost: minSlab[zoneKey]
      };
    }

    throw new Error(`Unable to calculate rate for weight ${weight} kg and zone ${zone}`);
  }
}

module.exports = new RateCardService();
