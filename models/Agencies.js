const mongoose = require('mongoose');


const agencySchema = new mongoose.Schema({
    password: { type: String, required: true },
    role: { type: String, default: 'agency' },

    agencyName: { type: String, trim: true },
    ownerName: { type: String, trim: true },
    oprateStation: { type: String, trim: true },

    // Unique + Sparse fields (fix for E11000)
    agencyEmail: { type: String, unique: true, sparse: true, trim: true, lowercase: true },
    agencyMobile: { type: String, unique: true, sparse: true, trim: true },
    agencyLicense: { type: String, unique: true, sparse: true, trim: true },
    gstNumber: { type: String, unique: true, sparse: true, trim: true },
    panNumber: { type: String, unique: true, sparse: true, trim: true },
    gumastaLicenseUrl: { type: String, trim: true }
}, { timestamps: true });

// no need to hash password

const Agency = mongoose.model('Agency', agencySchema);
module.exports = Agency;
