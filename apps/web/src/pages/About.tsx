import { Link } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  FileSearch, 
  Calendar, 
  Upload, 
  MessageSquare, 
  Phone, 
  Zap,
  Code,
  ArrowRight,
  CheckCircle
} from "lucide-react";

export default function About() {
  return (
    <Layout>
      <div className="container py-12">
        {/* Hero */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h1 className="text-4xl font-bold mb-4">About AI Demo Suite</h1>
          <p className="text-xl text-muted-foreground">
            Interactive demonstrations of cutting-edge AI tools for document search and intelligent booking.
          </p>
        </div>

        {/* How It Works */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-center mb-8">How to Use the Demos</h2>
          
          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* RAG Tool Instructions */}
            <Card>
              <CardHeader>
                <div className="w-12 h-12 rounded-lg gradient-bg flex items-center justify-center mb-4">
                  <FileSearch className="h-6 w-6 text-primary-foreground" />
                </div>
                <CardTitle>RAG Document Tool</CardTitle>
                <CardDescription>Intelligent document search and Q&A</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-4">
                  <li className="flex gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                      1
                    </div>
                    <div>
                      <p className="font-medium">Upload Documents</p>
                      <p className="text-sm text-muted-foreground">
                        Drag and drop PDF, TXT, or DOCX files into the upload zone
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                      2
                    </div>
                    <div>
                      <p className="font-medium">Ask Questions</p>
                      <p className="text-sm text-muted-foreground">
                        Type natural language questions about your documents
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                      3
                    </div>
                    <div>
                      <p className="font-medium">Get Cited Answers</p>
                      <p className="text-sm text-muted-foreground">
                        Receive AI-generated answers with source citations
                      </p>
                    </div>
                  </li>
                </ol>
                <Button asChild className="w-full mt-6">
                  <Link to="/rag-demo">
                    Try RAG Demo
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* Booking Agent Instructions */}
            <Card>
              <CardHeader>
                <div className="w-12 h-12 rounded-lg gradient-bg flex items-center justify-center mb-4">
                  <Calendar className="h-6 w-6 text-primary-foreground" />
                </div>
                <CardTitle>Smart Booking Agent</CardTitle>
                <CardDescription>AI-powered appointment scheduling</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-4">
                  <li className="flex gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                      1
                    </div>
                    <div>
                      <p className="font-medium">Choose Your Mode</p>
                      <p className="text-sm text-muted-foreground">
                        Select text chat or voice call based on your preference
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                      2
                    </div>
                    <div>
                      <p className="font-medium">Describe Your Needs</p>
                      <p className="text-sm text-muted-foreground">
                        Tell the AI what type of appointment you need and when
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                      3
                    </div>
                    <div>
                      <p className="font-medium">Confirm Booking</p>
                      <p className="text-sm text-muted-foreground">
                        Review and confirm your appointment on the calendar
                      </p>
                    </div>
                  </li>
                </ol>
                <Button asChild className="w-full mt-6">
                  <Link to="/booking">
                    Try Booking Demo
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Features */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-center mb-8">Key Features</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              {
                icon: Upload,
                title: "Document Upload",
                description: "Drag-and-drop support for PDF, TXT, and DOCX files",
              },
              {
                icon: MessageSquare,
                title: "Natural Language Chat",
                description: "Conversational interface for intuitive interactions",
              },
              {
                icon: Phone,
                title: "Voice Conversations",
                description: "Real-time voice calls with live transcription",
              },
              {
                icon: Calendar,
                title: "Calendar Integration",
                description: "Visual calendar showing availability and bookings",
              },
              {
                icon: Zap,
                title: "Instant Responses",
                description: "Fast AI-powered responses with minimal latency",
              },
              {
                icon: Code,
                title: "API Ready",
                description: "Integration points ready for your backend",
              },
            ].map((feature, idx) => (
              <Card key={idx} className="text-center">
                <CardContent className="pt-6">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Integration Section */}
        <section className="mb-16">
          <Card className="max-w-4xl mx-auto">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Ready for Your Backend</CardTitle>
              <CardDescription>
                These demos are designed with clear integration points for your AI services
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-semibold mb-3">Frontend Integration Points</h4>
                  <ul className="space-y-2">
                    {[
                      "Document upload handlers",
                      "Chat message submission",
                      "Streaming response support",
                      "Voice call WebSocket events",
                      "Calendar data fetching",
                    ].map((item, idx) => (
                      <li key={idx} className="flex items-center gap-2 text-sm">
                        <CheckCircle className="h-4 w-4 text-success" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold mb-3">Expected API Endpoints</h4>
                  <ul className="space-y-2">
                    {[
                      "POST /api/documents/upload",
                      "POST /api/chat/message",
                      "GET /api/calendar/availability",
                      "POST /api/bookings/create",
                      "WS /api/voice/connect",
                    ].map((item, idx) => (
                      <li key={idx} className="flex items-center gap-2 text-sm font-mono text-muted-foreground">
                        <Code className="h-4 w-4" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* CTA */}
        <section className="text-center">
          <h2 className="text-2xl font-bold mb-4">Start Exploring</h2>
          <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
            Try out the interactive demos and see how these AI tools can work for your use case.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild size="lg" className="gradient-bg">
              <Link to="/rag-demo">
                <FileSearch className="mr-2 h-4 w-4" />
                RAG Tool Demo
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/booking">
                <Calendar className="mr-2 h-4 w-4" />
                Booking Agent Demo
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </Layout>
  );
}
