async function testBookingEndpoints() {
  const baseUrl = 'http://localhost:3001/api/booking';

  console.log('🧪 Testing Booking Endpoints\n');

  try {
    // Test 1: Chat endpoint
    console.log('📝 Test 1: Chat endpoint');
    const chatResponse = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: "I'd like to book an appointment" }),
    });

    if (!chatResponse.ok) {
      console.error(`❌ Chat failed: ${chatResponse.status}`);
      const errorText = await chatResponse.text();
      console.error(errorText);
    } else {
      const chatData = await chatResponse.json();
      console.log('✅ Chat response received');
      console.log(`   - Conversation ID: ${chatData.conversationId}`);
      console.log(`   - Message: ${chatData.message.substring(0, 100)}...`);
      console.log(`   - Timestamp: ${chatData.timestamp}\n`);

      // Test 2: Follow-up message in same conversation
      console.log('📝 Test 2: Follow-up message in same conversation');
      const followUpResponse = await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'I prefer Tuesday afternoon',
          conversationId: chatData.conversationId,
        }),
      });

      if (!followUpResponse.ok) {
        console.error(`❌ Follow-up failed: ${followUpResponse.status}`);
      } else {
        const followUpData = await followUpResponse.json();
        console.log('✅ Follow-up response received');
        console.log(`   - Message: ${followUpData.message.substring(0, 100)}...`);
        console.log(`   - Same conversation: ${followUpData.conversationId === chatData.conversationId}\n`);
      }
    }

    // Test 3: Create appointment
    console.log('📝 Test 3: Create appointment');
    const appointmentResponse = await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: '2026-02-15',
        time: '2:00 PM',
        service: 'consultation',
      }),
    });

    if (!appointmentResponse.ok) {
      console.error(`❌ Appointment creation failed: ${appointmentResponse.status}`);
    } else {
      const appointmentData = await appointmentResponse.json();
      console.log('✅ Appointment created');
      console.log(`   - ID: ${appointmentData.id}`);
      console.log(`   - Date: ${appointmentData.date}`);
      console.log(`   - Time: ${appointmentData.time}`);
      console.log(`   - Service: ${appointmentData.service}`);
      console.log(`   - Status: ${appointmentData.status}\n`);
    }

    // Test 4: Get all appointments
    console.log('📝 Test 4: Get all appointments');
    const appointmentsResponse = await fetch(`${baseUrl}/appointments`, {
      method: 'GET',
    });

    if (!appointmentsResponse.ok) {
      console.error(`❌ Get appointments failed: ${appointmentsResponse.status}`);
    } else {
      const appointments = await appointmentsResponse.json();
      console.log('✅ Appointments retrieved');
      console.log(`   - Count: ${appointments.length}`);
      if (appointments.length > 0) {
        console.log(`   - Latest: ${appointments[0].date} at ${appointments[0].time}\n`);
      }
    }

    // Test 5: Check availability
    console.log('📝 Test 5: Check availability');
    const availabilityResponse = await fetch(
      `${baseUrl}/availability?date=2026-02-15`,
      {
        method: 'GET',
      }
    );

    if (!availabilityResponse.ok) {
      console.error(`❌ Availability check failed: ${availabilityResponse.status}`);
    } else {
      const availabilityData = await availabilityResponse.json();
      console.log('✅ Availability retrieved');
      console.log(`   - Date: ${availabilityData.date}`);
      console.log(`   - Available slots: ${availabilityData.availableSlots.length}`);
      const available = availabilityData.availableSlots.filter((s) => s.available);
      console.log(`   - Available: ${available.length}`);
      console.log(`   - Sample: ${available.slice(0, 3).map((s) => s.time).join(', ')}\n`);
    }

    console.log('✅ All tests completed!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testBookingEndpoints();
