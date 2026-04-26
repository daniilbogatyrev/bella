import { getDb } from './client';
import { adminUsers, customers, policies, claims, claimEvents, callSessions, transcripts, evidence } from './schema';
import { hashPassword } from './password';

async function seed() {
  const db = getDb();

  console.log('Seeding database...');

  // Delete all existing data (child tables first to respect foreign keys)
  await db.delete(evidence);
  await db.delete(transcripts);
  await db.delete(claimEvents);
  await db.delete(callSessions);
  await db.delete(claims);
  await db.delete(policies);
  await db.delete(customers);
  await db.delete(adminUsers);
  console.log('🗑️  Cleared existing data');

  const seedPassword = process.env.SEED_PASSWORD!;

  if(!seedPassword){
    throw new Error(`SEED_PASSWORD not defined`)
  }

  const defaultPasswordHash = await hashPassword(seedPassword);
  await db.insert(adminUsers).values({
    email: 'idevsubham@gmail.com',
    name: 'Subham',
    role: 'admin',
    passwordHash: defaultPasswordHash,
  });

  await db.insert(adminUsers).values({
    email: 'daniil.bogatyrev25@gmail.com',
    name: 'Daniil',
    role: 'admin',
    passwordHash: defaultPasswordHash,
  });
  console.log('✅ Default admin seeded');

  const [customer1] = await db
    .insert(customers)
    .values({
      phone: '+15551234567',
      firstName: 'John',
      lastName: 'Smith',
      dob: '1985-03-15',
      email: 'john.smith@email.com',
      address: '123 Main St, Springfield, IL 62701',
    })
    .returning();

  const [customer2] = await db
    .insert(customers)
    .values({
      phone: '+15559876543',
      firstName: 'Maria',
      lastName: 'Garcia',
      dob: '1990-07-22',
      email: 'maria.garcia@email.com',
      address: '456 Oak Ave, Portland, OR 97201',
    })
    .returning();

  const [customer3] = await db
    .insert(customers)
    .values({
      phone: '+15554445555',
      firstName: 'David',
      lastName: 'Chen',
      dob: '1978-11-30',
      email: 'david.chen@email.com',
      address: '789 Pine Rd, Austin, TX 78701',
    })
    .returning();

  const [customer4] = await db
    .insert(customers)
    .values({
      phone: '+491773612296',
      firstName: 'Alex',
      lastName: 'Hun',
      email: 'alex@email.com',
      address: 'Friedrichstraße 100, 10117 Berlin, Germany',
    })
    .returning();

  console.log(`Inserted 4 customers: ${customer1!.id}, ${customer2!.id}, ${customer3!.id}, ${customer4!.id}`);

  const [policy1] = await db
    .insert(policies)
    .values({
      customerId: customer1!.id,
      type: 'auto',
      planName: 'Comprehensive Auto Shield',
      status: 'active',
      premium: '189.50',
      startDate: '2026-01-15',
      endDate: '2027-01-15',
      details: {
        vehicleMake: 'Toyota',
        vehicleModel: 'Camry',
        vehicleYear: 2022,
        deductible: 500,
        coverageLimit: 100000,
      },
      coveredItems: 'Collision damage, liability, medical payments, uninsured motorist, roadside assistance, rental car reimbursement',
      notCoveredItems: 'Wear & tear, mechanical breakdown, personal belongings in car, commercial use',
    })
    .returning();

  const [policy2] = await db
    .insert(policies)
    .values({
      customerId: customer1!.id,
      type: 'home',
      planName: 'HomeGuard Premium',
      status: 'active',
      premium: '125.00',
      startDate: '2026-03-01',
      endDate: '2027-03-01',
      details: {
        propertyType: 'single_family',
        squareFeet: 2200,
        deductible: 1000,
        coverageLimit: 350000,
      },
      coveredItems: 'Dwelling structure, personal property, liability, additional living expenses, fire/theft/vandalism',
      notCoveredItems: 'Flood damage, earthquake, normal wear, pest damage, home business equipment',
    })
    .returning();

  const [policy3] = await db
    .insert(policies)
    .values({
      customerId: customer2!.id,
      type: 'auto',
      planName: 'Basic Auto Coverage',
      status: 'active',
      premium: '95.00',
      startDate: '2026-06-01',
      endDate: '2027-06-01',
      details: {
        vehicleMake: 'Honda',
        vehicleModel: 'Civic',
        vehicleYear: 2020,
        deductible: 1000,
        coverageLimit: 50000,
      },
      coveredItems: 'Collision damage, liability, medical payments, uninsured motorist, roadside assistance, rental car reimbursement',
      notCoveredItems: 'Wear & tear, mechanical breakdown, personal belongings in car, commercial use',
    })
    .returning();

  const [policy4] = await db
    .insert(policies)
    .values({
      customerId: customer3!.id,
      type: 'health',
      planName: 'Family Health Plus',
      status: 'active',
      premium: '450.00',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      coveredItems: 'Hospitalization, surgery, prescription drugs, preventive care, mental health services, emergency room visits',
      notCoveredItems: 'Cosmetic procedures, experimental treatments, dental (separate plan), vision (separate plan)',
    })
    .returning();

  const [policy5] = await db
    .insert(policies)
    .values({
      customerId: customer4!.id,
      type: 'liability',
      planName: 'Personal Liability Shield',
      status: 'active',
      premium: '75.00',
      startDate: '2026-04-01',
      endDate: '2027-04-01',
      details: {
        coverageLimit: 500000,
        deductible: 250,
      },
      coveredItems: 'Bodily injury to others, property damage to others, legal defense costs, medical payments to others',
      notCoveredItems: 'Intentional acts, business activities, professional services, motorized vehicle incidents (covered under auto)',
    })
    .returning();

  console.log(`Inserted 5 policies: ${policy1!.id}, ${policy2!.id}, ${policy3!.id}, ${policy4!.id}, ${policy5!.id}`);

  const [claim1] = await db
    .insert(claims)
    .values({
      customerId: customer1!.id,
      policyId: policy1!.id,
      type: 'auto_collision',
      status: 'gathering_info',
      description: 'Rear-ended at intersection on Main St.',
      incidentDate: '2026-10-12',
      incidentLocation: 'Main St & 5th Ave, Springfield, IL',
    })
    .returning();

  const [claim2] = await db
    .insert(claims)
    .values({
      customerId: customer2!.id,
      policyId: policy3!.id,
      type: 'auto_theft',
      status: 'submitted',
      description: 'Vehicle stolen from apartment parking garage.',
      incidentDate: '2026-11-05',
      incidentLocation: '456 Oak Ave Parking Garage, Portland, OR',
    })
    .returning();

  console.log(`Inserted 2 claims: ${claim1!.id}, ${claim2!.id}`);

  const [session1] = await db
    .insert(callSessions)
    .values({
      customerId: customer1!.id,
      claimId: claim1!.id,
      twilioCallSid: 'CA_SEED_001',
      callerPhone: '+15551234567',
      status: 'completed',
      endedAt: new Date(),
      summary: 'Customer reported rear-end collision. Claim opened and facts gathered.',
    })
    .returning();

  console.log(`Inserted 1 call session: ${session1!.id}`);

  await db.insert(claimEvents).values([
    {
      claimId: claim1!.id,
      sessionId: session1!.id,
      type: 'system' as const,
      content: 'Claim opened via phone call with Bella AI agent',
    },
    {
      claimId: claim1!.id,
      sessionId: session1!.id,
      type: 'fact' as const,
      content: 'Customer was stopped at red light when hit from behind by a pickup truck.',
    },
    {
      claimId: claim1!.id,
      sessionId: session1!.id,
      type: 'fact' as const,
      content: 'No injuries reported. Damage to rear bumper and trunk.',
    },
    {
      claimId: claim1!.id,
      sessionId: session1!.id,
      type: 'action' as const,
      content: 'Photo evidence requested from customer.',
    },
  ]);

  console.log('Inserted 4 claim events');

  await db.insert(transcripts).values([
    {
      sessionId: session1!.id,
      role: 'agent' as const,
      content: 'Hello! This is Bella from SafeGuard Insurance. How can I help you today?',
    },
    {
      sessionId: session1!.id,
      role: 'customer' as const,
      content: 'Hi, I was just in a car accident. Someone rear-ended me at an intersection.',
    },
    {
      sessionId: session1!.id,
      role: 'agent' as const,
      content: "I'm so sorry to hear that! Are you okay? Let me look up your account and we'll get a claim started right away.",
    },
  ]);

  console.log('Inserted 3 transcript entries');

  console.log('\nSeed data inserted successfully!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
