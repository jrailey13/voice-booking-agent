import { useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { CheckCircle, CalendarDays, Clock, Phone } from "lucide-react";
import { format } from "date-fns";
import { useAvailability, useCreateAppointment, useAppointments } from "@/hooks/useBookingChat";
import { useToast } from "@/hooks/use-toast";

interface Appointment {
  id: string;
  date: string;
  time: string;
  service: string;
  status: string;
}

export default function SimpleBooking() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [selectedService, setSelectedService] = useState<string>("consultation");
  const [isBooking, setIsBooking] = useState(false);

  const { toast } = useToast();
  const dateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";
  const { data: availability } = useAvailability(dateStr);
  const { mutateAsync: createAppointment } = useCreateAppointment();
  const { data: appointments, refetch: refetchAppointments } = useAppointments();

  const handleBooking = async () => {
    if (!selectedTime) {
      toast({
        title: "Select a time",
        description: "Please choose an available time slot",
        variant: "destructive",
      });
      return;
    }

    setIsBooking(true);
    try {
      await createAppointment({
        date: dateStr,
        time: selectedTime,
        service: selectedService,
      });

      toast({
        title: "Appointment booked!",
        description: `${selectedService} on ${format(selectedDate!, "MMMM d, yyyy")} at ${selectedTime}`,
      });

      setSelectedTime("");
      await refetchAppointments();
    } catch (error) {
      toast({
        title: "Booking failed",
        description: "Could not create appointment. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsBooking(false);
    }
  };

  return (
    <Layout>
      <div className="container py-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <CalendarDays className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">Book an Appointment</h1>
                <p className="text-muted-foreground">Select a date and time that works for you</p>
              </div>
            </div>
            <Button asChild variant="outline">
              <Link to="/voice-agent">
                <Phone className="mr-2 h-4 w-4" />
                Try Voice Agent
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left: Calendar & Time Slots */}
          <div className="lg:col-span-2 space-y-6">
            {/* Service Selection */}
            <Card>
              <CardHeader>
                <CardTitle>Service Type</CardTitle>
                <CardDescription>Choose what you need</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {["consultation", "follow-up", "initial assessment"].map((service) => (
                  <label key={service} className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-muted transition" onClick={() => setSelectedService(service)}>
                    <input
                      type="radio"
                      name="service"
                      value={service}
                      checked={selectedService === service}
                      onChange={() => setSelectedService(service)}
                      className="mr-3"
                    />
                    <span className="capitalize">{service}</span>
                  </label>
                ))}
              </CardContent>
            </Card>

            {/* Calendar */}
            <Card>
              <CardHeader>
                <CardTitle>Select Date</CardTitle>
                <CardDescription>Pick a date for your appointment</CardDescription>
              </CardHeader>
              <CardContent>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => {
                    if (date) {
                      setSelectedDate(date);
                      setSelectedTime(""); // Reset time when date changes
                    }
                  }}
                  disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                  className="rounded-md border w-full"
                />
              </CardContent>
            </Card>

            {/* Time Slots */}
            {selectedDate && (
              <Card>
                <CardHeader>
                  <CardTitle>Available Times</CardTitle>
                  <CardDescription>
                    {format(selectedDate, "EEEE, MMMM d, yyyy")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!availability ? (
                    <div className="text-center py-8 text-muted-foreground">
                      Loading available times...
                    </div>
                  ) : availability.availableSlots.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No slots available for this date
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {availability.availableSlots.map((slot) => (
                        <button
                          key={slot.time}
                          onClick={() => slot.available && setSelectedTime(slot.time)}
                          disabled={!slot.available}
                          className={`
                            p-3 rounded-lg border-2 transition font-medium
                            ${!slot.available
                              ? "border-muted bg-muted text-muted-foreground cursor-not-allowed opacity-50"
                              : selectedTime === slot.time
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted hover:border-primary hover:bg-accent"
                            }
                          `}
                        >
                          {slot.time}
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right: Summary & Booked Appointments */}
          <div className="space-y-6">
            {/* Booking Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Booking Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Service</p>
                  <p className="font-semibold capitalize">{selectedService}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Date</p>
                  <p className="font-semibold">{selectedDate ? format(selectedDate, "MMM d, yyyy") : "—"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Time</p>
                  <p className="font-semibold">{selectedTime || "—"}</p>
                </div>
                <Button
                  onClick={handleBooking}
                  disabled={!selectedTime || isBooking}
                  size="lg"
                  className="w-full"
                >
                  {isBooking ? "Booking..." : "Confirm Booking"}
                </Button>
              </CardContent>
            </Card>

            {/* Upcoming Appointments */}
            <Card>
              <CardHeader>
                <CardTitle>Your Appointments</CardTitle>
                <CardDescription>Confirmed bookings</CardDescription>
              </CardHeader>
              <CardContent>
                {!appointments || appointments.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No appointments yet
                  </p>
                ) : (
                  <div className="space-y-3">
                    {appointments.map((apt) => (
                      <div
                        key={apt.id}
                        className="flex items-start gap-3 p-3 bg-accent rounded-lg"
                      >
                        <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm capitalize">{apt.service}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            <CalendarDays className="h-3 w-3" />
                            <span>{apt.date}</span>
                            <Clock className="h-3 w-3 ml-1" />
                            <span>{apt.time}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
