// src/systems/auto-income.js - Fixed auto income system

const DatabaseManager = require('../database/manager');
const { calculateTotalCP, calculateBaseCPFromLevel } = require('../data/devil-fruits');

class AutoIncomeSystem {
    constructor() {
        this.isRunning = false;
        this.intervalId = null;
        this.INCOME_INTERVAL = 10 * 60 * 1000; // 10 minutes in milliseconds
        this.BASE_INCOME = 50;
        this.CP_MULTIPLIER = 0.1; // 10% of CP as income
        this.MAX_STORED_HOURS = 24;
    }

    async initialize(client) {
        this.client = client;
        console.log('⏰ Auto income system initializing...');
        this.start();
        return Promise.resolve();
    }

    start() {
        if (this.isRunning) {
            console.log('⚠️ Auto income system is already running');
            return;
        }

        console.log('🚀 Starting auto income system...');
        this.isRunning = true;
        
        // Run immediately, then every 10 minutes
        this.processIncome();
        this.intervalId = setInterval(() => {
            this.processIncome();
        }, this.INCOME_INTERVAL);
    }

    stop() {
        if (!this.isRunning) {
            console.log('⚠️ Auto income system is not running');
            return;
        }

        console.log('🛑 Stopping auto income system...');
        this.isRunning = false;
        
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    async processIncome() {
        const startTime = Date.now();
        console.log('⏰ Processing auto income...');

        try {
            // Get all users from database
            const users = await this.getAllUsers();
            console.log(`⏰ Found ${users.length} users for income processing`);

            if (users.length === 0) {
                console.log('⏰ No users found for income processing');
                return;
            }

            let processedCount = 0;
            let skippedCount = 0;
            let totalBerriesGenerated = 0;
            let errorCount = 0;

            // Process each user
            for (const user of users) {
                try {
                    const result = await this.processUserIncome(user);
                    
                    if (result.processed) {
                        processedCount++;
                        totalBerriesGenerated += result.berries;
                    } else {
                        skippedCount++;
                    }
                } catch (error) {
                    console.error(`❌ Error processing income for user ${user.user_id}:`, error);
                    errorCount++;
                }
            }

            const endTime = Date.now();
            const processingTime = endTime - startTime;

            console.log(`⏰ Income processing completed in ${processingTime}ms`);
            console.log(`⏰ Processed ${processedCount} users, skipped ${skippedCount}, errors ${errorCount}`);
            console.log(`⏰ Generated ${totalBerriesGenerated.toLocaleString()} berries total`);

        } catch (error) {
            console.error('❌ Error in auto income processing:', error);
        }
    }

    async getAllUsers() {
        try {
            const result = await DatabaseManager.query('SELECT * FROM users');
            return result.rows;
        } catch (error) {
            console.error('Error getting all users:', error);
            return [];
        }
    }

    async processUserIncome(user) {
        try {
            const userId = user.user_id;
            const now = new Date();
            
            // Get user's last income collection time
            const lastIncome = new Date(user.last_income || new Date(0));
            
            // Calculate time since last income
            const timeSinceLastIncome = now - lastIncome;
            const minutesSinceLastIncome = timeSinceLastIncome / (1000 * 60);
            
            // Only process if it's been at least 10 minutes since last income
            if (minutesSinceLastIncome < 10) {
                return { processed: false, berries: 0, reason: 'too_recent' };
            }

            // Calculate how much income to generate
            const incomeIntervals = Math.floor(minutesSinceLastIncome / 10);
            const maxIntervals = (this.MAX_STORED_HOURS * 60) / 10; // 144 intervals for 24 hours
            const intervalsToProcess = Math.min(incomeIntervals, maxIntervals);

            if (intervalsToProcess <= 0) {
                return { processed: false, berries: 0, reason: 'no_intervals' };
            }

            // Get user's fruits and calculate total CP
            const userFruits = await DatabaseManager.getUserDevilFruits(userId);
            const userLevel = user.level || 0;
            const baseCPFromLevel = calculateBaseCPFromLevel(userLevel);
            const totalCP = user.total_cp || baseCPFromLevel;

            // Calculate income per interval
            const incomePerInterval = this.BASE_INCOME + Math.floor(totalCP * this.CP_MULTIPLIER);
            const totalIncome = incomePerInterval * intervalsToProcess;

            // Add berries to user account
            await DatabaseManager.updateUserBerries(userId, totalIncome, 'Auto Income');

            // Update last income time
            await DatabaseManager.query(
                'UPDATE users SET last_income = NOW() WHERE user_id = $1',
                [userId]
            );

            // Log income history
            await DatabaseManager.recordIncome(userId, totalIncome, totalCP, 'automatic');

            return { 
                processed: true, 
                berries: totalIncome,
                intervals: intervalsToProcess,
                incomePerInterval: incomePerInterval
            };

        } catch (error) {
            console.error(`❌ Error processing income for user ${user.user_id}:`, error);
            throw error;
        }
    }

    async getUserIncomeInfo(userId) {
        try {
            const user = await DatabaseManager.getUser(userId);
            if (!user) {
                return null;
            }

            const userFruits = await DatabaseManager.getUserDevilFruits(userId);
            const userLevel = user.level || 0;
            const baseCPFromLevel = calculateBaseCPFromLevel(userLevel);
            const totalCP = user.total_cp || baseCPFromLevel;

            const incomePerInterval = this.BASE_INCOME + Math.floor(totalCP * this.CP_MULTIPLIER);
            const lastIncome = new Date(user.last_income || new Date(0));
            
            const now = new Date();
            const timeSinceLastIncome = now - lastIncome;
            const minutesSinceLastIncome = timeSinceLastIncome / (1000 * 60);
            
            const incomeIntervals = Math.floor(minutesSinceLastIncome / 10);
            const maxIntervals = (this.MAX_STORED_HOURS * 60) / 10;
            const availableIntervals = Math.min(incomeIntervals, maxIntervals);
            const pendingIncome = incomePerInterval * availableIntervals;

            return {
                incomePerInterval: incomePerInterval,
                pendingIncome: pendingIncome,
                availableIntervals: availableIntervals,
                maxIntervals: maxIntervals,
                lastIncome: lastIncome,
                totalCP: totalCP,
                level: userLevel
            };

        } catch (error) {
            console.error(`❌ Error getting income info for user ${userId}:`, error);
            return null;
        }
    }

    getStatus() {
        return {
            running: this.isRunning,
            intervalMs: this.INCOME_INTERVAL,
            baseIncome: this.BASE_INCOME,
            cpMultiplier: this.CP_MULTIPLIER,
            maxStoredHours: this.MAX_STORED_HOURS
        };
    }
}

// Export as singleton instance
module.exports = new AutoIncomeSystem();
