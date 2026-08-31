import { Link } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileSearch, Calendar, Sparkles, ArrowRight, MessageSquare, Phone } from "lucide-react";

const Index = () => {
  return (
    <Layout>
      {/* Hero Section */}
      <section className="relative overflow-hidden py-20 md:py-32">
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
        </div>
        <div className="container">
          <div className="flex flex-col items-center text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 bg-secondary rounded-full px-4 py-1.5 text-sm font-medium mb-6">
              <Sparkles className="h-4 w-4 text-primary" />
              <span>Experience AI in Action</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
              Next-Generation{" "}
              <span className="gradient-text">AI Tools</span>{" "}
              for Your Business
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl">
              Explore our interactive demos showcasing intelligent document search and 
              conversational booking agents. See how AI can transform your workflows.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Button asChild size="lg" className="gradient-bg">
                <Link to="/rag-demo">
                  Try RAG Tool
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/booking">
                  Book an Appointment
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Products Section */}
      <section className="py-20 bg-muted/30">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Our AI Products</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Two powerful AI solutions designed to enhance productivity and customer experience.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* RAG Tool Card */}
            <Card className="group hover:shadow-lg transition-all duration-300 border-2 hover:border-primary/20">
              <CardHeader>
                <div className="w-12 h-12 rounded-lg gradient-bg flex items-center justify-center mb-4">
                  <FileSearch className="h-6 w-6 text-primary-foreground" />
                </div>
                <CardTitle className="text-2xl">RAG Document Tool</CardTitle>
                <CardDescription className="text-base">
                  Intelligent document search and retrieval with AI-powered answers
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 text-sm text-muted-foreground mb-6">
                  <li className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                    Upload PDFs, TXT, and DOCX files
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                    Ask questions in natural language
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                    Get answers with source citations
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                    Real-time document processing
                  </li>
                </ul>
                <Button asChild className="w-full group-hover:gradient-bg transition-all">
                  <Link to="/rag-demo">
                    Try Demo
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* Booking Agent Card */}
            <Card className="group hover:shadow-lg transition-all duration-300 border-2 hover:border-primary/20">
              <CardHeader>
                <div className="w-12 h-12 rounded-lg gradient-bg flex items-center justify-center mb-4">
                  <Calendar className="h-6 w-6 text-primary-foreground" />
                </div>
                <CardTitle className="text-2xl">Smart Booking Agent</CardTitle>
                <CardDescription className="text-base">
                  AI-powered scheduling assistant via text or voice conversation
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 text-sm text-muted-foreground mb-6">
                  <li className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-primary" />
                    Natural text conversation
                  </li>
                  <li className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-primary" />
                    Voice/phone call support
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                    Smart calendar integration
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                    Instant appointment confirmation
                  </li>
                </ul>
                <Button asChild className="w-full group-hover:gradient-bg transition-all">
                  <Link to="/booking">
                    Try Demo
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20">
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Why Choose Our AI Suite?</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Built with cutting-edge technology for seamless integration and exceptional performance.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {[
              { title: "Lightning Fast", description: "Sub-second response times powered by optimized AI models" },
              { title: "Highly Accurate", description: "State-of-the-art accuracy with verifiable source citations" },
              { title: "Easy Integration", description: "RESTful APIs and webhooks for seamless connectivity" },
              { title: "Enterprise Ready", description: "Secure, scalable, and compliant with industry standards" },
            ].map((feature, idx) => (
              <div key={idx} className="text-center p-6">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <div className="w-3 h-3 rounded-full gradient-bg" />
                </div>
                <h3 className="font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-muted/30">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-3xl font-bold mb-4">Ready to Get Started?</h2>
            <p className="text-muted-foreground mb-8">
              Try our interactive demos now and see how AI can transform your business operations.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button asChild size="lg" className="gradient-bg">
                <Link to="/rag-demo">
                  Start with RAG Tool
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/about">
                  Learn More
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-bg">
                <Sparkles className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="font-semibold">AI Demo Suite</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © 2024 AI Demo Suite. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </Layout>
  );
};

export default Index;
