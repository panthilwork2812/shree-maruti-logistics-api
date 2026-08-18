const localPincodes = require('../data/pincodeMaster.json');

class PincodeService {
  /**
   * Find pincode entry from dataset (Google Sheet or local JSON fallback)
   */
  lookupPincode(pincode, pincodeDataset = null) {
    const dataset = pincodeDataset || localPincodes;
    const cleanPincode = pincode.toString().trim();
    
    return dataset.find(item => item.pincode === cleanPincode) || null;
  }

  /**
   * Determine Zone category relative to shipment route
   * Zones: Local, Within Zone / Within State, Metro, ROI, Special Zone
   */
  determineZone(pickupPincode, deliveryPincode, pincodeDataset = null) {
    const cleanPickup = pickupPincode.toString().trim();
    const cleanDelivery = deliveryPincode.toString().trim();

    // Same pickup & delivery pincode -> Local
    if (cleanPickup === cleanDelivery) {
      return 'Local';
    }

    const deliveryEntry = this.lookupPincode(cleanDelivery, pincodeDataset);

    if (deliveryEntry) {
      const location = (deliveryEntry.clientLocation || '').trim();
      
      // Normalize zone name
      if (/local/i.test(location)) return 'Local';
      if (/within state|within zone/i.test(location)) return 'Within Zone';
      if (/metro/i.test(location)) return 'Metro';
      if (/special zone/i.test(location)) return 'Special Zone';
      if (/roi/i.test(location)) return 'ROI';

      return location || 'ROI';
    }

    // Default fallback based on standard Indian Pincode prefixes
    // If pickup and delivery share first 2 digits (e.g. 39xxxx and 38xxxx -> Gujarat/Within State)
    if (cleanPickup.substring(0, 2) === cleanDelivery.substring(0, 2)) {
      return 'Within Zone';
    }

    return 'ROI'; // Rest of India fallback
  }
}

module.exports = new PincodeService();
