const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const { put } = require('@vercel/blob');
const router = express.Router();
const nodemailer = require('nodemailer');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require("fs");
const ejs = require('ejs'); // <-- Import EJS for rendering the string
require("dotenv").config();

// --- Models ---
const Agency = require('../models/Agencies'); // This path is correct
const Driver = require('../models/Driver');
const Vehicle = require('../models/Vehicle');
const Booking = require('../models/Booking');
const OTP = require('../models/OTP');

// --- FIX: Corrected path to be in the same folder ---
const { mumbaiNetworkData } = require('../models/mumbaiAPI.js');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // Use STARTTLS
    auth: {
        user: process.env.USER,
        pass: process.env.PASS
    },
    tls: {
        rejectUnauthorized: false
    },
    debug: true,
    logger: true
});


// Verify email configuration on startup
transporter.verify(function (error, success) {
    if (error) {
        console.log('❌ Email transporter verification failed:', error);
    } else {
        console.log('✅ Email server is ready to send messages');
    }
});

// --- Multer Configuration ---
const storageMemory = multer.memoryStorage();
const uploadMemory = multer({ storage: storageMemory });

// --- Middleware ---
function isAuthenticated(req, res, next) {
    if (req.session && req.session.AgenciesId) {
        return next();
    }
    return res.redirect('/login');
}

// --- GET Routes ---
router.get('/', (req, res) => res.render('login', { message: '' }));
router.get('/login', (req, res) => res.render('login', { message: '' }));
router.get('/signup', (req, res) => res.render('signup', { message: '' }));
router.get('/booking-request', isAuthenticated, (req, res) => res.render('bookingRequest', { message: '' }));

// --- UPDATED /register-agency Route ---
router.get('/register-agency', (req, res) => {
    try {
        // 1. Extract all station names from the API data
        const allStations = mumbaiNetworkData.routes.flatMap(route => 
            route.stations.map(station => station.station_name)
        );
        
        // 2. Get unique, sorted station names
        const uniqueStations = [...new Set(allStations)].sort();

        // 3. Render the page, passing the stations array
        res.render('agencySignup', { 
            stations: uniqueStations, // Pass the station list
            message: '' // Pass an empty message
        });
    } catch (err) {
        console.error("Error processing station data:", err);
        res.render('agencySignup', { 
            stations: [], // Pass an empty array on error
            message: 'Could not load station data.' 
        });
    }
});

router.get('/approvedRides', isAuthenticated, async (req, res) => {
    // ... (rest of your route)
    try {
        if (!req.session.AgenciesId) {
            return res.render('approvedRides', {
                approvedList: [],
                error: "Could not find your agency ID. Please log in again."
            });
        }
        const approvideAllRides = await Booking.find({
            agencyId: req.session.AgenciesId ,
            status: { $in: ['approved', 'ongoing', 'completed'] }
        });
        res.render('approvedRides', {
            approvedList: approvideAllRides,
            error: null
        });
    } catch (err) {
        res.render('approvedRides', {
            approvedList: [],
            error: "An error occurred while fetching rides." 
        });
    }
});

router.get('/addDriver', isAuthenticated, async (req, res) => {
    // ... (rest of your route)
    try {
        const availableVehicles = await Vehicle.find({
            agencyId: req.session.AgenciesId,
            assignedDriver: null
        }).sort({ vehicle_name: 1 });
        res.render('addDriver', { vehicles: availableVehicles });
    } catch (err) {
        res.render('addDriver', { vehicles: [] });
    }
});

router.get('/viewDriver', isAuthenticated, async (req, res) => {
    // ... (rest of your route)
    try {
        const agencyDrivers = await Driver.find({
            agencyId: req.session.AgenciesId
        })
        .populate('assignedVehicle')
        .sort({ fullName: 1 });

        const availableVehicles = await Vehicle.find({
            agencyId: req.session.AgenciesId,
            assignedDriver: null
        });

        res.render('viewDriver', {
            drivers: agencyDrivers,
            availableVehicles: availableVehicles,
            error: null
        });
    } catch (err) {
        res.render('viewDriver', {
            drivers: [],
            availableVehicles: [],
            error: "Could not fetch the driver list. Please try again."
        });
    }
});

router.get('/addVehicles', isAuthenticated, (req, res) => res.render('addVehicles'));

router.get('/viewVehicles', isAuthenticated, async (req, res) => {
    // ... (rest of your route)
    try {
        const vehicles = await Vehicle.find({ agencyId: req.session.AgenciesId }).sort({ createdAt: -1 });
        res.render('viewVehicles', { vehicles, error: null });
    } catch (err) {
        res.render('viewVehicles', { vehicles: [], error: 'Could not fetch vehicles.' });
    }
});

router.get('/manageBooking', isAuthenticated, async (req, res) => {
    // ... (rest of your route)
    try {
        const agencyId = req.session.AgenciesId;
        const pendingBookings = await Booking.find({ 
            status: 'pending', 
            agencyId: agencyId 
        })
        .populate('vehicleId', 'vehicle_name number_plate') 
        .sort({ requestDate: -1 });

        const vehicleIds = pendingBookings
            .map(booking => booking.vehicleId._id)
            .filter((value, index, self) => self.indexOf(value) === index);

        const agencyDrivers = await Driver.find({
            assignedVehicle: { $in: vehicleIds }, 
        })
        .select('fullName assignedVehicle')
        .populate('assignedVehicle', 'vehicle_name number_plate') 
        .sort({ fullName: 1 });

        res.render('manageBooking', {
            bookings: pendingBookings,
            drivers: agencyDrivers, 
            error: null
        });
    } catch (err) {
        res.render('manageBooking', { bookings: [], drivers: [], error: "Could not fetch data." });
    }
});

router.get('/dashboard', isAuthenticated, async (req, res) => {
    // ... (rest of your route)
    try {
        let user = await Agency.findById(req.session.AgenciesId);
        if (!user) {
            user = await Driver.findById(req.session.AgenciesId);
        }
        if (!user) {
            return res.redirect('/login');
        }
        if (user.role === 'agency') {
            res.render('dashboard', { agency: user });
        } else if (user.role === 'driver') {
            res.send(`Welcome Driver ${user.fullName}`);
        } else {
            res.send(`Welcome User ${user.name}`);
        }
    } catch (err) {
        res.status(500).send("Error loading your dashboard. Please try again later.");
    }
});

router.get('/logout', (req, res) => {
    // ... (rest of your route)
    req.session.destroy(err => {
        if (err) return res.redirect('/dashboard');
        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
});

// --- POST Routes ---

router.post('/api/upload', uploadMemory.single('gumastaLicense'), async (req, res) => {
    // ... (rest of your route)
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded.' });
    }
    const sanitizedFilename = req.file.originalname.replace(/\s+/g, '-');
    const filename = `${Date.now()}-${sanitizedFilename}`;
    try {
        const blob = await put(filename, req.file.buffer, { access: 'public' });
        res.status(200).json(blob);
    } catch (error) {
        res.status(500).json({ message: 'Error uploading file.' });
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        let user = await Agency.findOne({ agencyEmail: email });

        if (!user) {
            user = await Driver.findOne({ email: email });
        }

        if (!user) return res.render('login', { message: 'Invalid credentials.' });

        // --- PASSWORD FIX: Plain text comparison ---
        const isMatch = (password === user.password);
        
        if (!isMatch) return res.render('login', { message: 'Invalid credentials.' });

        req.session.AgenciesId = user._id;
        req.session.AgenciesName = user.agencyName || user.fullName;
        req.session.AgenciesEmail = user.agencyEmail || user.email;
        req.session.AgenciesRole = user.role;

        if (user.role === 'agency') {
            res.redirect('/manageBooking');
        } else if (user.role === 'driver') {
            res.redirect('/dashboard');
        } else {
            res.redirect('/dashboard');
        }
    } catch (err) {
        res.render('login', { message: 'Server error. Please try again.' });
    }
});

router.post('/register-agency', uploadMemory.single('gumastaLicense'), async (req, res) => {
    // ... (rest of your route)
    try {
        const {
            agencyName, ownerName, oprateStation, agencyEmail, agencyMobile,
            agencyLicense, gstNumber, panNumber, password,
            gumastaLicenseUrl
        } = req.body;

        let finalBlobUrl = gumastaLicenseUrl;

        if (req.file) {
             const sanitizedFilename = req.file.originalname.replace(/\s+/g, '-');
             const filename = `gumasta-${Date.now()}-${sanitizedFilename}`;
             const blob = await put(filename, req.file.buffer, { access: 'public' });
             finalBlobUrl = blob.url;
        }

        if (!finalBlobUrl) {
            return res.status(400).json({ message: 'Gumasta License file is required.' });
        }

        const newAgency = new Agency({
            agencyEmail,
            password,
            agencyName,
            ownerName,
            oprateStation,
            agencyMobile,
            agencyLicense,
            gstNumber,
            panNumber,
            gumastaLicenseUrl: finalBlobUrl
        });

        await newAgency.save();
        res.status(201).json({ message: 'Agency registered successfully! You can now log in.' });

    } catch (err) {
        console.error("Error registering agency:", err);
        if (err.code === 11000) {
             return res.status(409).json({ message: 'An agency with this email, mobile, GST, or PAN already exists.' });
        }
        res.status(500).json({ message: 'Server error. Please try again.' });
    }
});

router.post('/adddriver', isAuthenticated, async (req, res) => {
    // ... (rest of your route)
    const { fullName, age, gender, mobile, email, license, address, tempPassword, assignedVehicle } = req.body;
    try {
        if (await Driver.findOne({
            $or: [{ email }, { mobile }, { licenseNumber: license }]
        })) {
            return res.status(409).json({ message: 'A driver with this email, mobile, or license already exists.' });
        }

        const newDriver = new Driver({
            fullName,
            email,
            password: tempPassword,
            age,
            gender,
            mobile,
            address,
            licenseNumber: license,
            agencyId: req.session.AgenciesId,
            assignedVehicle: assignedVehicle || null
        });

        await newDriver.save();

        if (assignedVehicle) {
            await Vehicle.findByIdAndUpdate(assignedVehicle, { assignedDriver: newDriver._id });
        }
        res.status(201).json({ message: 'Driver registered successfully!' });
    } catch (err) {
        res.status(500).json({ message: 'Server error. Please try again.' });
    }
});

router.post('/editDriver', isAuthenticated, async (req, res) => {
    // ... (rest of your route)
    try {
        const { driverID, fullName, email, mobile, licenseNumber, address, assignedVehicle } = req.body;
        const originalDriver = await Driver.findById(driverID);
        if (!originalDriver) {
            return res.redirect('/viewDriver');
        }
        const oldVehicleId = originalDriver.assignedVehicle;
        await Driver.findByIdAndUpdate(driverID, {
            fullName, email, mobile, licenseNumber, address,
            assignedVehicle: assignedVehicle || null
        });
        if (oldVehicleId?.toString() !== assignedVehicle) {
            if (oldVehicleId) {
                await Vehicle.findByIdAndUpdate(oldVehicleId, { assignedDriver: null });
            }
            if (assignedVehicle) {
                await Vehicle.findByIdAndUpdate(assignedVehicle, { assignedDriver: driverID });
            }
        }
        res.redirect('/viewDriver');
    } catch (err) {
        res.redirect('/viewDriver');
    }
});

router.post('/deleteDriver', isAuthenticated, async (req, res) => {
    // ... (rest of your route)
    try {
        const { driverID } = req.body;
        const driverToDelete = await Driver.findById(driverID);
        if (driverToDelete) {
            if (driverToDelete.assignedVehicle) {
                await Vehicle.findByIdAndUpdate(driverToDelete.assignedVehicle, {
                    assignedDriver: null
                });
            }
            await Driver.findByIdAndDelete(driverID);
        }
        res.redirect('/viewDriver');
    } catch (err) {
        res.redirect('/viewDriver');
    }
});

router.post('/addvehicle', isAuthenticated, async (req, res) => {
    // ... (rest of your route)
    const { vehicle_name, model, number_plate, rc_number, insurance_number, owner_name, ac_type, vehicle_type, max_capacity, rate_per_km } = req.body;
    const vehicleNumber = number_plate;
    try {
        if (!vehicleNumber) {
             return res.status(400).json({ message: 'Number plate is required.' });
        }
        if (await Vehicle.findOne({ number_plate: vehicleNumber })) {
            return res.status(409).json({ message: 'Vehicle with this number plate already exists.' });
        }
        await new Vehicle({
            vehicle_name, model, 
            number_plate: vehicleNumber,
            vehicleNumber: vehicleNumber,
            rc_number, insurance_number, owner_name, ac_type, 
            vehicle_type, max_capacity, rate_per_km,
            agencyId: req.session.AgenciesId
        }).save();
        res.status(201).json({ message: 'Vehicle added successfully!' });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ message: 'A vehicle with this number plate already exists.' });
        }
        res.status(500).json({ message: 'Server error. Please try again.' });
    }
});

router.post('/bookingrequest', isAuthenticated, async (req, res) => {
    // ... (rest of your route)
    try {
        const { from, to, date } = req.body;
        const agency = await Agency.findOne({ role: "agency" });
        if (!agency) {
            return res.render('bookingRequest', { message: 'Sorry, no agencies are available.' });
        }
        await new Booking({
            name: req.session.AgenciesName,
            email: req.session.AgenciesEmail,
            from, to, date,
            agencyId: agency._id
        }).save();
        res.render('bookingRequest', { message: 'Booking request submitted successfully!' });
    } catch (err) {
        res.render('bookingRequest', { message: 'Error submitting booking. Please try again.' });
    }
});
router.post('/approvebooking', isAuthenticated, async (req, res) => {
    try {
        const { requestId, driverID, fare } = req.body;

        // --- 1. Validation & Data Fetching ---
        if (!requestId || !mongoose.Types.ObjectId.isValid(requestId) || 
            !driverID || !mongoose.Types.ObjectId.isValid(driverID) || !fare) {
            return res.redirect('/manageBooking');
        }

        // 1a. Fetch Booking, populating the Agency (using 'Agency' as the model ref name)
        const booking = await Booking.findById(requestId).populate({
            path: 'agencyId',
            model: 'Agency' 
        });
        
        // 1b. Fetch Driver (which contains the assignedVehicle ID)
        const assignedDriver = await Driver.findById(driverID).select('fullName mobile assignedVehicle');

        let assignedVehicle = null;
        if (assignedDriver && assignedDriver.assignedVehicle) {
            // 1c. Fetch Vehicle using the ID from the driver
            assignedVehicle = await Vehicle.findById(assignedDriver.assignedVehicle).select('vehicle_name ac_type number_plate');
        }

        // 1d. Critical Data Check 
        if (!booking || !assignedDriver || !assignedVehicle || !booking.customerEmail) {
            console.error("Critical data missing for email confirmation. Objects available:", {
                booking: !!booking,
                driver: !!assignedDriver,
                vehicle: !!assignedVehicle,
                customerEmail: booking ? booking.customerEmail : 'N/A'
            });
            if (booking) {
                await Booking.findByIdAndUpdate(requestId, { status: 'approved', assigneddriverID: driverID, fare: fare });
            }
            return res.redirect('/manageBooking');
        }
        
        // --- 2. Extract & Format Data for Email ---
        
        // Data from Booking Model
        const customerName = booking.customerName || 'Valued Customer'; 
        const customerEmail = booking.customerEmail; 
        
        // Data from Agency Model
        const approvedAgencyName = booking.agencyId ? booking.agencyId.agencyName : 'N/A';
        
        // Data from Driver Model
        const driverName = assignedDriver.fullName;
        const driverMobile = assignedDriver.mobile || 'N/A'; 
        
        // Data from Vehicle Model (Using vehicle_name and ac_type)
        const vehicleName = assignedVehicle.vehicle_name || 'N/A';
        const vehicleType = assignedVehicle.ac_type || 'N/A'; // Using ac_type for Vehicle Type, as per your model
        const vehiclePlate = assignedVehicle.number_plate || 'N/A';


        // Combine and format Date and Time
        const formattedDateTime = `${booking.date || 'N/A'} at ${booking.time || 'N/A'}`;
        
        
        // --- 3. Update Booking Status ---
        await Booking.findByIdAndUpdate(requestId, { 
            status: 'approved',
            assigneddriverID: driverID,
            fare: fare,
            driverName: driverName,
            vehicleId: assignedVehicle._id, 
        });
        
        // --- 4. Define the HTML Template String (EJS Syntax) ---
        const emailTemplate = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Ride Confirmation | Sharing Yatra</title>
                <style>
                    /* Basic Styles */
                    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; font-family: Arial, sans-serif; }
                    .container { max-width: 600px; width: 100%; }
                    .header-bg { background-color: #0056b3; color: white; padding: 20px 0; }
                    .main-text { color: #2c3e50; font-size: 15px; line-height: 1.6; margin: 0 0 10px 0; }
                    .section-header { color: #2c3e50; font-size: 16px; font-weight: 700; margin: 25px 0 10px 0; display: block; }
                    .detail-table { width: 100%; border: 1px solid #e0e0e0; border-collapse: collapse; margin-bottom: 25px; font-size: 14px; }
                    .detail-table th, .detail-table td { padding: 12px 15px; border: 1px solid #e0e0e0; text-align: left; }
                    .detail-table th { width: 35%; font-weight: 400; color: #2c3e50; }
                    .detail-table td { color: #2c3e50; font-weight: 500; }
                    .fare-value { color: #3498db; font-weight: 700; }
                </style>
            </head>
            <body style="margin: 0; padding: 0; background-color: #f4f7f6;">
            <center>
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
                <tr>
                    <td align="center" style="padding: 0;">
                        <table border="0" cellpadding="0" cellspacing="0" class="container" style="background-color: white;">
                            <tr><td align="center" class="header-bg"><h1 style="font-size: 24px; margin: 0; padding: 10px 0;">Sharing Yatra</h1></td></tr>
                            <tr>
                                <td style="padding: 20px 30px;">
                                    <p class="main-text">Dear <b><%= customerName %></b>, </p>
                                    <p class="main-text">We are pleased to confirm your ride booking. Please find the details below.</p>
                                    
                                    <span class="section-header">Your Ride Details</span>
                                    <table class="detail-table" cellpadding="0" cellspacing="0">
                                        <tbody>
                                         <tr><th>Pick Up Address</th><td><%= booking.pickupAddress %></td></tr>
                                            <tr><th>From</th><td><%= booking.from %></td></tr>
                                            <tr><th>To</th><td><%= booking.to %></td></tr>
                                            <tr><th>Date & Time </th><td><%= formattedDateTime %></td></tr>
                                            <tr><th>Total Fare</th><td class="fare-value">₹ <%= fare %></td></tr>
                                            <tr><th>Approved Agency</th><td><%= approvedAgencyName %></td></tr>
                                        </tbody>
                                    </table>
                                    
                                    <span class="section-header">Your Driver & Vehicle Details</span>
                                    <table class="detail-table" cellpadding="0" cellspacing="0">
                                        <tbody>
                                            <tr><th>Driver Name</th><td><%= driverName %></td></tr>
                                            <tr><th>Driver Mobile</th><td><a href="tel:<%= driverMobile %>"><%= driverMobile %></a></td></tr>
                                            <tr><th>Vehicle Name</th><td><%= vehicleName %></td></tr>
                                            <tr><th>Vehicle Type</th><td><%= vehicleType %></td></tr>
                                            <tr><th>Vehicle Plate</th><td><%= vehiclePlate %></td></tr>
                                        </tbody>
                                    </table>

                                    <p class="main-text" style="margin-top: 15px;">Thank you for choosing <b>Sharing Yatra</b>. We wish you a safe and pleasant journey!</p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
            </center>
            </body>
            </html>
        `;

        // --- 5. Render EJS String into Final HTML (FIXED MAPPING) ---
        const finalHtml = ejs.render(emailTemplate, {
            booking: booking,
            fare: fare,
            driverName: driverName,
            driverMobile: driverMobile,
            formattedDateTime: formattedDateTime,
            customerName: customerName,
            approvedAgencyName: approvedAgencyName,
            
            // ✅ FIX: The key must match the EJS template tag (vehicleName)
            vehicleName: vehicleName, 
            vehicleType: vehicleType,
            vehiclePlate: vehiclePlate 
        });


        // --- 6. Send Email ---
        await transporter.sendMail({
            from: process.env.USER || 'sharingyatra@gmail.com',
            to: customerEmail, 
            subject: 'Confirmation: Your Sharing Yatra Ride is Approved', 
            html: finalHtml 
        });
        
        res.redirect('/manageBooking');
        
    } catch (err) {
        console.error("Booking approval failed:", err);
        res.redirect('/manageBooking'); 
    }
});

router.post('/rejectbooking', isAuthenticated, async (req, res) => {
    // ... (rest of your route)
    try {
        const { requestId } = req.body;
        await Booking.findByIdAndUpdate(requestId, { status: 'rejected' });
        res.redirect('/manageBooking');
    } catch (err) {
        res.redirect('/manageBooking');
    }
});

async function getEarningsData(agencyId, startDate, endDate) {
    
    // Convert your YYYY-MM-DD form inputs into real Date objects.
    const startOfDay = new Date(startDate); 
    const endOfDay = new Date(endDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    try {
        const completedBookings = await Booking.find({
            agencyId: agencyId,
            status: 'completed',
            
            // We use $expr to run a complex comparison operation
            $expr: {
                $and: [
                    // Condition 1: Is the booking date >= startOfDay?
                    {
                        $gte: [
                            { 
                                $dateFromString: {
                                    dateString: '$date',
                                    // --- THIS IS THE FIX ---
                                    // Match your database format: "YYYY-MM-DD"
                                    format: '%Y-%m-%d' 
                                }
                            },
                            startOfDay
                        ]
                    },
                    // Condition 2: Is the booking date <= endOfDay?
                    {
                        $lte: [
                            {
                                $dateFromString: {
                                    dateString: '$date',
                                    // --- THIS IS THE FIX ---
                                    // Match your database format: "YYYY-MM-DD"
                                    format: '%Y-%m-%d'
                                }
                            },
                            endOfDay
                        ]
                    }
                ]
            }
        });

        // The rest of your function is correct
        let totalEarnings = 0;
        const driverMap = new Map();
        
        for (const booking of completedBookings) {
            const fare = Number(booking.fare) || 0;
            totalEarnings += fare;
            
            if (booking.driverID && booking.driverName) {
                const driverId = booking.driverID.toString();
                const driverName = booking.driverName;
                
                if (driverMap.has(driverId)) {
                    driverMap.get(driverId).total += fare;
                } else {
                    driverMap.set(driverId, { name: driverName, total: fare });
                }
            }
        }
        
        const driverEarnings = [];
        for (const [driverId, data] of driverMap.entries()) {
            const contribution = (totalEarnings > 0) ? (data.total / totalEarnings) * 100 : 0;
            driverEarnings.push({
                name: data.name,
                total: data.total,
                contribution: contribution.toFixed(2)
            });
        }
        
        driverEarnings.sort((a, b) => b.total - a.total);
        
        // Success: return the calculated data
        return { totalEarnings, driverEarnings };

    } catch (err) {
        // If the query fails (like a format mismatch), log it and re-throw
        console.error("Error during getEarningsData aggregation:", err);
        // This will be caught by your main router's catch block
        throw new Error("Failed to query earnings data."); 
    }
}


router.get('/earning', isAuthenticated, async (req, res) => {
    // ... (rest of your route)
    try {
        const todayString = new Date().toISOString().split('T')[0];
        const { totalEarnings, driverEarnings } = await getEarningsData(
            req.session.AgenciesId,
            todayString,
            todayString
        );
        res.render('earning', {
            totalEarnings,
            driverEarnings,
            startDate: todayString,
            endDate: todayString,
            error: null
        });
    } catch (err) {
        res.render('earning', {
            totalEarnings: 0,
            driverEarnings: [],
            startDate: new Date().toISOString().split('T')[0],
            endDate: new Date().toISOString().split('T')[0],
            error: "Could not fetch earnings data. Please try again."
        });
    }
});

router.post('/earning', isAuthenticated, async (req, res) => {
    // ... (rest of your route)
    try {
        const { startDate, endDate } = req.body;
        if (!startDate || !endDate) {
            return res.redirect('/earning');
        }
        const { totalEarnings, driverEarnings } = await getEarningsData(
            req.session.AgenciesId,
            startDate,
            endDate
        );
        res.render('earning', {
            totalEarnings,
            driverEarnings,
            startDate: startDate,
            endDate: endDate,
            error: null
        });
    } catch (err) {
        res.render('earning', {
            totalEarnings: 0,
            driverEarnings: [],
            startDate: req.body.startDate || new Date().toISOString().split('T')[0],
            endDate: req.body.endDate || new Date().toISOString().split('T')[0],
            error: "Could not fetch earnings for the selected date range."
        });
    }
});



router.post('/edit-agency', isAuthenticated, async (req, res) => {
    try {
        // 1. Get ONLY the editable data from the form body
        const { agencyName, ownerName, agencyMobile, oprateStation } = req.body;
        
        // 2. Get the logged-in agency's ID from the session
        const agencyId = req.session.AgenciesId;

        // 3. Find the agency by its ID and update only the allowed fields
        // This is secure because we explicitly list what can be updated,
        // ignoring other fields like gstNumber or agencyEmail from the request.
        await Agency.findByIdAndUpdate(agencyId, {
            agencyName: agencyName,
            ownerName: ownerName,
            agencyMobile: agencyMobile,
            oprateStation: oprateStation
        });

        // 4. On success, redirect back to the dashboard to see the changes
        res.redirect('/dashboard');

    } catch (err) {
        // 5. On error, log it and redirect back to the dashboard
        console.error("Error updating agency profile:", err);
        // You could add an error message here using connect-flash if you have it
        res.redirect('/dashboard');
    }
});



router.post('/editVehicle', isAuthenticated, async (req, res) => {
    try {
        // Get the vehicle ID and all form data
        const { 
            vehicleID,
            vehicle_name, 
            model, 
            number_plate, 
            rc_number, 
            insurance_number, 
            owner_name, 
            ac_type, 
            vehicle_type, 
            max_capacity, 
            rate_per_km 
        } = req.body;

        // Find by ID and update all fields from the form
        await Vehicle.findByIdAndUpdate(vehicleID, {
            vehicle_name,
            model,
            number_plate,
            rc_number,
            insurance_number,
            owner_name,
            ac_type,
            vehicle_type,
            max_capacity,
            rate_per_km
        });

        res.redirect('/viewVehicles');

    } catch (err) {
        console.error("Error updating vehicle:", err);
        // You could redirect back with an error message here
        res.redirect('/viewVehicles');
    }
});


/**
 * =========================================
 * POST /deleteVehicle - Delete a Vehicle
 * =========================================
 */
router.post('/deleteVehicle', isAuthenticated, async (req, res) => {
    try {
        const { vehicleID } = req.body;

        // Find the vehicle first to see if it's assigned to a driver
        const vehicleToDelete = await Vehicle.findById(vehicleID);

        if (vehicleToDelete) {
            // If a driver is assigned to this vehicle, un-assign them
            if (vehicleToDelete.assignedDriver) {
                await Driver.findByIdAndUpdate(vehicleToDelete.assignedDriver, {
                    assignedVehicle: null
                });
            }
            
            // Now, delete the vehicle
            await Vehicle.findByIdAndDelete(vehicleID);
        }

        res.redirect('/viewVehicles');

    } catch (err) {
        console.error("Error deleting vehicle:", err);
        res.redirect('/viewVehicles');
    }
});



router.get('/forgetPassword', (req, res) => {
    // Pass 'message' as null and 'isError' as false initially
    res.render('forgetPassword', { message: null, isError: false });
});


// --- 2. VERIFY USER DETAILS ---
// Handles the submission from the 'forgetPassword' form
router.post('/forgetPassword', async (req, res) => {
    try {
        const { email, agencyMobile, documentType, documentValue } = req.body;

        // 1. Basic validation
        if (!email || !agencyMobile || !documentType || !documentValue) {
            return res.render('forgetPassword', { 
                message: 'All fields are required.', 
                isError: true 
            });
        }

        // 2. Find the agency by email
        const agency = await Agency.findOne({ agencyEmail: email.toLowerCase() });
        if (!agency) {
            return res.render('forgetPassword', { 
                message: 'No account found with that email.', 
                isError: true 
            });
        }

        // 3. Verify their mobile number
        if (agency.agencyMobile !== agencyMobile) {
            return res.render('forgetPassword', { 
                message: 'Agency mobile number does not match.', 
                isError: true 
            });
        }

        // 4. Verify their chosen document
        let isDocValid = false;
        switch (documentType) {
            case 'gstNumber':
                isDocValid = (agency.gstNumber === documentValue);
                break;
            case 'panNumber':
                isDocValid = (agency.panNumber === documentValue);
                break;
            case 'agencyLicense':
                isDocValid = (agency.agencyLicense === documentValue);
                break;
            default:
                return res.render('forgetPassword', { 
                    message: 'Invalid document type selected.', 
                    isError: true 
                });
        }

        if (!isDocValid) {
            return res.render('forgetPassword', { 
                message: `The ${documentType} provided does not match our records.`, 
                isError: true 
            });
        }

        // 5. SUCCESS! User is verified.
        // Store their ID in the session to prove they are allowed to reset the password
        req.session.resetId = agency._id;
        
        // Redirect them to the *new* password reset page
        res.redirect('/resetPassword');

    } catch (err) {
        console.error(err);
        res.render('forgetPassword', { 
            message: 'A server error occurred. Please try again later.', 
            isError: true 
        });
    }
});

// --- 3. RENDER THE NEW PASSWORD PAGE ---
// Serves the page where the user can enter a new password
router.get('/resetPassword', (req, res) => {
    // SECURITY CHECK:
    // If they haven't been verified (i.e., no resetId in session),
    // send them back to the start.
    if (!req.session.resetId) {
        return res.redirect('/forgetPassword');
    }

    res.render('resetPassword', { message: null, isError: false });
});

// --- 4. SAVE THE NEW PASSWORD ---
// Handles the submission of the new password
router.post('/resetPassword', async (req, res) => {
    // SECURITY CHECK:
    if (!req.session.resetId) {
        return res.redirect('/forgetPassword');
    }

    try {
        const { password, confirmPassword } = req.body;

        // 1. Validate passwords
        if (!password || !confirmPassword) {
            return res.render('resetPassword', { 
                message: 'Both password fields are required.', 
                isError: true 
            });
        }
        if (password !== confirmPassword) {
            return res.render('resetPassword', { 
                message: 'Passwords do not match.', 
                isError: true 
            });
        }

        // 2. Find the user from the session ID
        const agency = await Agency.findById(req.session.resetId);
        if (!agency) {
            // This should rarely happen, but it's a good safeguard
            delete req.session.resetId;
            return res.redirect('/forgetPassword');
        }

        // 3. Update the password (using plaintext, as per your login route)
        agency.password = password;
        await agency.save();

        // 4. Clean up the session
        delete req.session.resetId;

        // 5. Send them to login with a SUCCESS message
        res.render('login', { 
            message: 'Password reset successfully. Please log in.', 
            isError: false // This will style it as a success message
        });

    } catch (err) {
        console.error(err);
        res.render('resetPassword', { 
            message: 'A server error occurred. Please try again.', 
            isError: true 
        });
    }
});





router.post('/change-password', isAuthenticated, async (req, res) => {
    const agencyId = req.session.AgenciesId;
    const { currentPassword, newPassword, confirmNewPassword } = req.body;

    // 1. Basic Validation
    if (newPassword !== confirmNewPassword) {
        return res.status(400).json({ message: 'New passwords do not match.' });
    }
    
    if (newPassword.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters long.' });
    }

    try {
        const agency = await Agency.findById(agencyId);

        if (!agency) {
            return res.status(404).json({ message: 'Agency not found.' });
        }

        // 2. Verify Current Password (Plain text comparison)
        const isMatch = (currentPassword === agency.password);
        
        if (!isMatch) {
            return res.status(400).json({ message: 'Incorrect current password.' });
        }

        // 3. Update the password
        agency.password = newPassword;
        await agency.save();

        // 4. Success Response
        res.status(200).json({ message: 'Password updated successfully! Please re-login.' });

    } catch (err) {
        console.error('Password change error:', err);
        res.status(500).json({ message: 'A server error occurred during password update.' });
    }
});

module.exports = router;



