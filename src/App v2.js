import React, { useState, useEffect, useCallback, useMemo } from 'react'; // Added useMemo
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, onSnapshot, collection, query, limit } from 'firebase/firestore'; // Removed orderBy import as it's not used in query

// Shim for process.env in browser environments, if not already defined
// This helps ensure process.env is available even if the build tool doesn't fully polyfill it.
if (typeof window.process === 'undefined') {
    window.process = { env: {} };
}

// Main App component for the Quantum Leap AI Education Academy
const App = () => {
    // --- Firebase State ---
    const [db, setDb] = useState(null);
    // eslint-disable-next-line no-unused-vars
    const [auth, setAuth] = useState(null); // auth is used internally by Firebase, but not directly in JSX
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false); // To ensure Firestore ops wait for auth

    // --- App State ---
    const [currentModule, setCurrentModule] = useState(null); // The currently active module object
    const [modules, setModules] = useState([]); // List of all modules for the current user
    const [topic, setTopic] = useState(''); // Input for new module topic
    const [resourceInput, setResourceInput] = ''; // Input for new resource URL/description
    const [questions, setQuestions] = useState([]); // AI-generated test questions
    const [userAnswers, setUserAnswers] = useState({}); // User's selected answers
    // eslint-disable-next-line no-unused-vars
    const [score, setScore] = useState(0); // Current assessment score (used in submitTest, but ESLint might miss it if not in JSX)
    // eslint-disable-next-line no-unused-vars
    const [showCertificate, setShowCertificate] = useState(false); // Certificate visibility (used in submitTest, but ESLint might miss it if not in JSX)
    const [userName, setUserName] = useState(''); // User's name for certificate
    const [loading, setLoading] = useState(false); // Loading indicator for AI generation
    const [errorMessage, setErrorMessage] = useState(''); // Error messages
    const [appPhase, setAppPhase] = useState('moduleSelect'); // 'moduleSelect', 'resources', 'assignment', 'quiz', 'finalTest', 'results'
    const [assessmentMetrics, setAssessmentMetrics] = useState(null); // AI's meta-commentary on assessment
    const [lastScoreDetails, setLastScoreDetails] = useState(null); // Details for module results table
    const [teacherPicks, setTeacherPicks] = useState([]); // Dynamically generated teacher's picks
    const [assignmentContent, setAssignmentContent] = useState(null); // Dynamically generated assignment content

    // --- NEW Assignment State ---
    const [currentAssignmentSectionIndex, setCurrentAssignmentSectionIndex] = useState(0);
    const [assignmentResponses, setAssignmentResponses] = useState({}); // To store user's assignment answers per task

    // --- Constants from Environment Variables (Adapted for standard React App) ---
    // These variables should be defined in your .env file in the project root
    const appId = process.env.REACT_APP_CUSTOM_APP_ID || 'default-quantum-leap-app';
    
    // Use useMemo to ensure firebaseConfig object is stable across renders
    // FIX: This ensures the firebaseConfig object is created only once, resolving the ESLint warning.
    const firebaseConfig = useMemo(() => ({
        apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
        authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
        storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.REACT_APP_FIREBASE_APP_ID,
        measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID // Optional
    }), []); // Empty dependency array means it's created once

    // initialAuthToken is typically for specific Canvas/LTI environments.
    // For a standard React app, we'll sign in anonymously if no other auth is used.
    const initialAuthToken = null; // Set to null for standard React app unless explicitly provided

    // --- Gemini API Key: Using process.env for standard React App ---
    const geminiApiKey = process.env.REACT_APP_GEMINI_API_KEY; // This should be in your .env file

    // --- Firebase Initialization and Authentication ---
    useEffect(() => {
        // Basic validation for firebaseConfig
        if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
            setErrorMessage("Firebase configuration is missing. Please check your .env file.");
            setIsAuthReady(true); // Mark as ready to avoid infinite loading, but with error
            return;
        }

        try {
            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const firebaseAuth = getAuth(app);

            setDb(firestore);
            setAuth(firebaseAuth);

            // Listen for auth state changes
            const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
                if (user) {
                    setUserId(user.uid);
                    console.log("Authenticated as:", user.uid);
                } else {
                    // Sign in anonymously if no token or token fails
                    try {
                        if (initialAuthToken) {
                            await signInWithCustomToken(firebaseAuth, initialAuthToken);
                        } else {
                            await signInAnonymously(firebaseAuth);
                        }
                    } catch (error) {
                        console.error("Firebase auth error during anonymous/custom token sign-in:", error);
                        setErrorMessage("Failed to authenticate. Please try refreshing.");
                    }
                }
                setIsAuthReady(true); // Auth state is now known
            });

            return () => unsubscribe(); // Cleanup auth listener
        } catch (error) {
            console.error("Firebase initialization failed:", error);
            setErrorMessage("Failed to initialize the academy. Check console for details.");
            setIsAuthReady(true); // Mark as ready to avoid infinite loading, but with error
        }
    }, [firebaseConfig, initialAuthToken]); // Dependencies for useEffect

    // --- Fetch Modules from Firestore ---
    useEffect(() => {
        // Ensure db, userId, and auth readiness before attempting to fetch
        if (!db || !userId || !isAuthReady) return;

        const modulesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/modules`);
        // orderBy is commented out as per previous instructions to avoid index issues
        const q = query(modulesCollectionRef, limit(100)); // Order by creation for display

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedModules = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            // Sort in memory if orderBy was removed from query
            fetchedModules.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            setModules(fetchedModules);
            console.log("Fetched modules:", fetchedModules);
        }, (error) => {
            console.error("Error fetching modules:", error);
            setErrorMessage("Failed to load your modules.");
        });

        return () => unsubscribe(); // Cleanup snapshot listener
    }, [db, userId, appId, isAuthReady]);

    // --- Firestore Helpers ---
    // FIX: Re-added appId to useCallback dependency array to resolve ESLint warning.
    const getModuleDocRef = useCallback((moduleId) => {
        if (!db || !userId) return null;
        return doc(db, `artifacts/${appId}/users/${userId}/modules`, moduleId);
    }, [db, userId, appId]); // appId is a dependency

    // FIX: Re-added appId to useCallback dependency array to resolve ESLint warning.
    const updateModuleInFirestore = useCallback(async (moduleId, data) => {
        if (!db || !userId) {
            setErrorMessage("Database not ready. Please try again.");
            return;
        }
        try {
            const moduleRef = getModuleDocRef(moduleId);
            if (moduleRef) {
                await setDoc(moduleRef, data, { merge: true });
                console.log(`Module ${moduleId} updated.`);
            }
        } catch (error) {
            console.error("Error updating module:", error);
            setErrorMessage(`Failed to save module progress: ${error.message}`);
        }
    }, [db, userId, getModuleDocRef, appId]); // appId is a dependency

    // --- AI Generation for Resources and Assignments ---
    const generateModuleContent = useCallback(async (moduleName, moduleId) => {
        setLoading(true);
        setErrorMessage('');
        if (!geminiApiKey) {
            setErrorMessage("Gemini API Key is not set. Please set REACT_APP_GEMINI_API_KEY in your .env file.");
            setLoading(false);
            return;
        }

        try {
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;

            // 1. Generate Teacher's Picks (existing logic)
            const resourcePrompt = `Provide 3-5 highly recommended, reputable, and ideally open-access or widely available online resources (PDFs, websites, video series) for learning "${moduleName}". Format as a JSON array of objects with 'title' and 'url' properties. If a direct URL isn't common, provide a general description/search term.`;
            const resourcePayload = {
                contents: [{ role: "user", parts: [{ text: resourcePrompt }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                "title": { "type": "STRING" },
                                "url": { "type": "STRING" }
                            },
                            "required": ["title"]
                        }
                    }
                }
            };

            const resourceResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(resourcePayload)
            });
            const resourceResult = await resourceResponse.json();
            let parsedResources = [];
            if (resourceResult.candidates && resourceResult.candidates.length > 0 && resourceResult.candidates[0].content && resourceResult.candidates[0].content.parts && resourceResult.candidates[0].content.parts.length > 0) {
                try {
                    parsedResources = JSON.parse(resourceResult.candidates[0].content.parts[0].text);
                } catch (e) {
                    console.error("Failed to parse resources JSON:", e, resourceResult.candidates[0].content.parts[0].text);
                    setErrorMessage("AI generated malformed resources. Trying again or using fallback.");
                    parsedResources = [{ title: "Could not generate specific picks. Please try again or add manually.", url: "#" }];
                }
            } else {
                parsedResources = [{ title: "No specific picks generated. Please add your own resources.", url: "#" }];
            }
            setTeacherPicks(parsedResources);
            await updateModuleInFirestore(moduleId, { teacherPicks: parsedResources });

            // 2. Generate Assignment Content (NEW, detailed structure)
            // MODIFIED PROMPT: Now explicitly asks for content based on moduleName, while maintaining the *structure* of the health tracker example.
            const assignmentPrompt = `Generate a comprehensive assignment for a module on "${moduleName}".
            The assignment MUST strictly follow the structural layout (number of sections, number of tasks per section, marks per task, types of tasks like text_input/code_input) of a typical coding assignment, similar to the "Simple Health Tracker Application" example you were previously given.
            However, the ENTIRE CONTENT (scenario, question titles, task descriptions, and resources) must be ORIGINAL and RELEVANT to "${moduleName}", NOT about health tracking or Python unless "${moduleName}" is specifically a Python topic.
            For any coding tasks, assume Python is the default language unless a different language is strongly implied by the module name.
            Ensure all fields in the JSON schema are populated accurately and completely.

            Assignment Structure Example (DO NOT USE THIS CONTENT, ONLY THE STRUCTURE):
            Total Marks: 100
            Scenario: Your assignment will have a main scenario.

            Question 1: (20 Marks)
            Sub-Scenario: This question will have a sub-scenario.
            Task 1.1: (10 Marks) [text_input]
            Task 1.2: (10 Marks) [text_input]

            Question 2: (30 Marks)
            Sub-Scenario: This question will have a sub-scenario.
            Task 2.1: (15 Marks) [code_input, e.g., Python]
            Task 2.2: (15 Marks) [code_input, e.g., Python]

            Question 3: (20 Marks)
            Sub-Scenario: This question will have a sub-scenario.
            Task 3.1: (20 Marks) [text_input]

            Question 4: (30 Marks)
            Sub-Scenario: This question will have a sub-scenario.
            Task 4.1: (20 Marks) [text_input]
            Task 4.2: (10 Marks) [text_input]

            Provide the output as a JSON object strictly following this schema, including relevant resources for "${moduleName}":
            `;

            const assignmentSchema = {
                type: "OBJECT",
                properties: {
                    title: { type: "STRING" },
                    total_marks: { type: "NUMBER" },
                    scenario: {
                        type: "OBJECT",
                        properties: {
                            title: { type: "STRING" },
                            description: { type: "STRING" }
                        },
                        required: ["title", "description"]
                    },
                    sections: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                section_id: { type: "STRING" },
                                section_title: { type: "STRING" },
                                marks: { type: "NUMBER" },
                                sub_scenario: {
                                    type: "OBJECT",
                                    properties: {
                                        title: { type: "STRING" },
                                        description: { type: "STRING" }
                                    },
                                    required: ["title", "description"]
                                },
                                tasks: {
                                    type: "ARRAY",
                                    items: {
                                        type: "OBJECT",
                                        properties: {
                                            task_id: { type: "STRING" },
                                            task_description: { type: "STRING" },
                                            marks: { type: "NUMBER" },
                                            type: { type: "STRING", enum: ["text_input", "code_input"] },
                                            language: { type: "STRING" } // Optional, for code_input
                                        },
                                        required: ["task_id", "task_description", "marks", "type"]
                                    }
                                }
                            },
                            required: ["section_id", "section_title", "marks", "sub_scenario", "tasks"]
                        }
                    },
                    resources: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                title: { type: "STRING" },
                                url: { type: "STRING" },
                                type: { type: "STRING", enum: ["website", "video", "pdf", "book"] },
                                category: { type: "STRING" }
                            },
                            required: ["title", "url", "type", "category"]
                        }
                    }
                },
                required: ["title", "total_marks", "scenario", "sections", "resources"]
            };

            const assignmentPayload = {
                contents: [{ role: "user", parts: [{ text: assignmentPrompt }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: assignmentSchema
                }
            };

            const assignmentResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!assignmentResponse.ok) {
                const errorData = await assignmentResponse.json();
                throw new Error(`API error: ${assignmentResponse.status} - ${errorData.error.message || assignmentResponse.statusText}`);
            }

            const assignmentResult = await assignmentResponse.json();
            let parsedAssignment = null;
            if (assignmentResult.candidates && assignmentResult.candidates.length > 0 && assignmentResult.candidates[0].content && assignmentResult.candidates[0].content.parts && assignmentResult.candidates[0].content.parts.length > 0) {
                try {
                    parsedAssignment = JSON.parse(assignmentResult.candidates[0].content.parts[0].text);
                } catch (e) {
                    console.error("Failed to parse assignment JSON:", e, assignmentResult.candidates[0].content.parts[0].text);
                    setErrorMessage("AI generated malformed assignment. Using fallback.");
                    // Provide a minimal fallback that matches the new structure to prevent further errors
                    parsedAssignment = {
                        title: `Generic Assignment for ${moduleName}`,
                        total_marks: 100,
                        scenario: { title: "Generic Scenario", description: "This is a fallback assignment." },
                        sections: [{
                            section_id: "fallback1",
                            section_title: "Part 1: Fallback Tasks",
                            marks: 50,
                            sub_scenario: { title: "Fallback Sub-scenario", description: "Review basic concepts." },
                            tasks: [{ task_id: "F1.1", task_description: "Complete task A.", marks: 25, type: "text_input" }]
                        }],
                        resources: []
                    };
                }
            } else {
                // Also provide a minimal fallback if no content is generated
                parsedAssignment = {
                    title: `Generic Assignment for ${moduleName}`,
                    total_marks: 100,
                    scenario: { title: "Generic Scenario", description: "This is a fallback assignment." },
                    sections: [{
                        section_id: "fallback1",
                        section_title: "Part 1: Fallback Tasks",
                        marks: 50,
                        sub_scenario: { title: "Fallback Sub-scenario", description: "Review basic concepts." },
                        tasks: [{ task_id: "F1.1", task_description: "Complete task A.", marks: 25, type: "text_input" }]
                    }],
                    resources: []
                };
            }
            setAssignmentContent(parsedAssignment);
            await updateModuleInFirestore(moduleId, { assignmentContent: parsedAssignment });

        } catch (error) {
            console.error('Error generating module content:', error);
            setErrorMessage(`Failed to generate module content: ${error.message}. Ensure your API key is valid.`);
            setTeacherPicks([]);
            setAssignmentContent(null);
        } finally {
            setLoading(false);
        }
    }, [geminiApiKey, updateModuleInFirestore]);

    // --- Module Management ---
    const createNewModule = async () => {
        if (!topic.trim()) {
            setErrorMessage('Please enter a topic for the new module.');
            return;
        }
        if (!db || !userId) {
            setErrorMessage("Database not ready. Please wait for authentication.");
            return;
        }
        if (!geminiApiKey) {
            setErrorMessage("Gemini API Key is not set. Please set REACT_APP_GEMINI_API_KEY in your .env file.");
            return;
        }

        setLoading(true);
        setErrorMessage('');
        try {
            const moduleId = `module-${Date.now()}`;
            const newModuleData = {
                name: topic,
                status: 'started',
                resources: [],
                teacherPicks: [],
                assignmentContent: null,
                assignments: {}, // Assignments will now be tracked by section completion, not part1/part2
                quizzes: [],
                finalTestScore: 0,
                certificateIssued: false,
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
            };
            await setDoc(getModuleDocRef(moduleId), newModuleData);
            setCurrentModule({ id: moduleId, ...newModuleData });
            setAppPhase('assignment'); // Start directly at assignment for new modules
            setTopic('');
            console.log("New module created:", newModuleData);
            await generateModuleContent(newModuleData.name, moduleId);
            const updatedModuleDoc = await getDoc(getModuleDocRef(moduleId));
            if (updatedModuleDoc.exists()) {
                setCurrentModule({ id: updatedModuleDoc.id, ...updatedModuleDoc.data() });
            }
            setCurrentAssignmentSectionIndex(0); // Reset to first section for new assignment
            setAssignmentResponses({}); // Clear previous responses
        } catch (error) {
            console.error("Error creating module:", error);
            setErrorMessage(`Failed to create module: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const selectModule = async (module) => {
        setCurrentModule(module);
        setErrorMessage('');
        setTeacherPicks(module.teacherPicks || []);
        setAssignmentContent(module.assignmentContent || null);

        // Determine phase based on module status
        if (module.status === 'completed' || module.status === 'needs_revisit') {
            setAppPhase('results');
            setLastScoreDetails({
                score: module.finalTestScore,
                comment: module.status === 'completed' ? 'Congratulations! You have mastered this module.' : 'This module requires further study and practice.',
                certificateIssued: module.certificateIssued
            });
        } else {
            // If assignment content is missing or not yet generated, attempt to generate it
            if (!module.assignmentContent || !module.teacherPicks || module.teacherPicks.length === 0) {
                setAppPhase('assignment'); // Stay on assignment phase while loading/generating
                setLoading(true); // Indicate loading
                await generateModuleContent(module.name, module.id);
                // After generation, fetch the updated module to ensure state is consistent
                const updatedModuleDoc = await getDoc(getModuleDocRef(module.id));
                if (updatedModuleDoc.exists()) {
                    setCurrentModule({ id: updatedModuleDoc.id, ...updatedModuleDoc.data() });
                    setAssignmentContent(updatedModuleDoc.data().assignmentContent); // Update assignment content state
                    setTeacherPicks(updatedModuleDoc.data().teacherPicks); // Update teacher picks state
                }
                setLoading(false);
            }

            // After ensuring assignmentContent is loaded/generated, proceed with phase determination
            if (module.status === 'assignment_done') {
                setAppPhase('quiz');
            } else if (module.quizzes.length > 0 && module.quizzes.every(q => q.score >= 80)) { // All quizzes passed
                setAppPhase('finalTest');
            } else {
                setAppPhase('assignment'); // Default to assignment if not completed or quizzes not passed
            }
            setCurrentAssignmentSectionIndex(0); // Go to first section of assignment
            setAssignmentResponses({}); // Clear responses when selecting module
        }
    };

    const addResource = async () => {
        if (!resourceInput.trim() || !currentModule) {
            setErrorMessage('Please enter a resource or select a module.');
            return;
        }
        const updatedResources = [...currentModule.resources, resourceInput];
        const updatedModule = { ...currentModule, resources: updatedResources, status: 'resources_added', lastUpdated: new Date().toISOString() };
        setCurrentModule(updatedModule);
        await updateModuleInFirestore(currentModule.id, { resources: updatedResources, status: 'resources_added', lastUpdated: updatedModule.lastUpdated });
        setResourceInput('');
    };

    // --- NEW Assignment Navigation & Submission ---
    const handleAssignmentResponseChange = (sectionId, taskId, value) => {
        setAssignmentResponses(prev => ({
            ...prev,
            [sectionId]: {
                ...(prev[sectionId] || {}),
                [taskId]: value
            }
        }));
    };

    const goToNextAssignmentSection = async () => {
        if (assignmentContent && currentAssignmentSectionIndex < assignmentContent.sections.length - 1) {
            setCurrentAssignmentSectionIndex(prev => prev + 1);
        } else {
            // This is the last section, so consider assignment complete
            if (currentModule) {
                const updatedAssignments = { ...currentModule.assignments, completed: true }; // Mark assignment as completed
                const updatedModule = { ...currentModule, assignments: updatedAssignments, status: 'assignment_done', lastUpdated: new Date().toISOString() };
                setCurrentModule(updatedModule);
                await updateModuleInFirestore(currentModule.id, { assignments: updatedAssignments, status: updatedModule.status, lastUpdated: updatedModule.lastUpdated });
                setAppPhase('quiz'); // Move to quiz phase
            }
        }
    };

    const goToPreviousAssignmentSection = () => {
        if (currentAssignmentSectionIndex > 0) {
            setCurrentAssignmentSectionIndex(prev => prev - 1);
        }
    };

    const submitAssignment = async () => {
        if (!currentModule || !assignmentContent) {
            setErrorMessage("No assignment to submit.");
            return;
        }
        // In a real app, you'd send assignmentResponses to a backend for grading.
        // For now, we'll just mark it as complete.
        const updatedAssignments = { ...currentModule.assignments, completed: true, responses: assignmentResponses };
        const updatedModule = { ...currentModule, assignments: updatedAssignments, status: 'assignment_done', lastUpdated: new Date().toISOString() };
        setCurrentModule(updatedModule);
        await updateModuleInFirestore(currentModule.id, { assignments: updatedAssignments, status: updatedModule.status, lastUpdated: updatedModule.lastUpdated });
        setAppPhase('quiz'); // Move to quiz phase
        alert('Assignment submitted! (In a real app, this would be graded)');
    };

    // --- AI Test Generation ---
    const generateTest = async (type) => { // 'quiz' or 'finalTest'
        if (!currentModule) {
            setErrorMessage('Please select or create a module first.');
            return;
        }
        if (!geminiApiKey) {
            setErrorMessage("Gemini API Key is not set. Please set REACT_APP_GEMINI_API_KEY in your .env file.");
            return;
        }

        setLoading(true);
        setErrorMessage('');
        setQuestions([]);
        setUserAnswers({});
        setScore(0);
        setShowCertificate(false);
        setAssessmentMetrics(null);

        // Include current module's resources in the prompt for AI to base questions on
        // Combine user-added and AI-generated teacher picks
        const combinedResources = [
            ...(currentModule.resources || []),
            ...(teacherPicks || []).map(p => p.url || p.title)
        ];
        const resourceListForPrompt = combinedResources.length > 0 ? `The questions must be directly based on the following types of resources: ${combinedResources.join(', ')}.` : 'The questions must be directly based on standard academic textbooks and lectures.';

        const promptBase = `Generate a multiple-choice test with 5 questions about "${currentModule.name}". Each question should have 4 options (A, B, C, D) and indicate the correct answer. ${resourceListForPrompt}`;
        const promptSpecific = type === 'quiz' ?
            `${promptBase} Focus on fundamental concepts and problem-solving applications. This is a practice quiz.` :
            `${promptBase} This is a comprehensive final test, covering both theoretical derivations and complex problem-solving.`;

        // Simulate AI metrics based on test type
        const simulatedMetrics = type === 'quiz' ? {
            practicalityTheoreticity: '60% Theoretical / 40% Practical',
            predictability: 'Highly Predictable',
            difficulty: 'Intermediate Graduate Level',
            alignment: '100% Aligned with designated resources.',
            learningTime: '5-10 minutes per attempt',
            proficiencyRequired: 'Basic understanding of concepts.'
        } : {
            practicalityTheoreticity: '50% Theoretical / 50% Practical',
            predictability: 'Moderately Predictable (requires synthesis)',
            difficulty: 'High Graduate Level',
            alignment: '100% Aligned with designated resources.',
            learningTime: '2-3 hours for completion',
            proficiencyRequired: 'Strong, analytical understanding and problem-solving skills.'
        };
        setAssessmentMetrics(simulatedMetrics);

        try {
            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: promptSpecific }] });

            const payload = {
                contents: chatHistory,
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                "question": { "type": "STRING" },
                                "options": {
                                    "type": "OBJECT",
                                    "properties": {
                                        "A": { "type": "STRING" },
                                        "B": { "type": "STRING" },
                                        "C": { "type": "STRING" },
                                        "D": { "type": "STRING" }
                                    },
                                    "required": ["A", "B", "C", "D"]
                                },
                                "correctAnswer": { "type": "STRING" }
                            },
                            "required": ["question", "options", "correctAnswer"]
                        }
                    }
                }
            };

            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API error: ${response.status} - ${errorData.error.message || response.statusText}`);
            }

            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const jsonString = result.candidates[0].content.parts[0].text;
                const parsedQuestions = JSON.parse(jsonString);
                setQuestions(parsedQuestions);
            } else {
                setErrorMessage('Failed to generate questions. Please try again.');
            }
        } catch (error) {
            console.error('Error generating test:', error);
            setErrorMessage(`Error generating test: ${error.message}. Ensure your API key is valid and enabled for Gemini.`);
        } finally {
            setLoading(false);
        }
    };

    const handleAnswerChange = (questionIndex, selectedOption) => {
        setUserAnswers(prevAnswers => ({
            ...prevAnswers,
            [questionIndex]: selectedOption
        }));
    };

    const submitTest = async (type) => { // 'quiz' or 'finalTest'
        if (questions.length === 0) {
            setErrorMessage('Please generate a test first.');
            return;
        }

        let correctCount = 0;
        questions.forEach((q, index) => {
            if (userAnswers[index] === q.correctAnswer) {
                correctCount++;
            }
        });
        const calculatedScore = (correctCount / questions.length) * 100;
        setScore(calculatedScore);

        if (!currentModule) return;

        if (type === 'quiz') {
            const updatedQuizzes = [...currentModule.quizzes, { score: calculatedScore, date: new Date().toISOString() }];
            const updatedModule = { ...currentModule, quizzes: updatedQuizzes, lastUpdated: new Date().toISOString() };
            setCurrentModule(updatedModule);
            await updateModuleInFirestore(currentModule.id, { quizzes: updatedQuizzes, lastUpdated: updatedModule.lastUpdated });
            if (calculatedScore >= 80) {
                setAppPhase('finalTest');
            }
        } else if (type === 'finalTest') {
            const certificateIssued = calculatedScore >= 80;
            const status = certificateIssued ? 'completed' : 'needs_revisit';
            const updatedModule = {
                ...currentModule,
                finalTestScore: calculatedScore,
                certificateIssued: certificateIssued,
                status: status,
                lastUpdated: new Date().toISOString()
            };
            setCurrentModule(updatedModule);
            await updateModuleInFirestore(currentModule.id, {
                finalTestScore: calculatedScore,
                certificateIssued: certificateIssued,
                status: status,
                lastUpdated: updatedModule.lastUpdated
            });
            setLastScoreDetails({
                score: calculatedScore,
                comment: certificateIssued ? 'Congratulations! You have mastered this module.' : 'This module requires further study and practice.',
                certificateIssued: certificateIssued
            });
            setShowCertificate(certificateIssued);
            setAppPhase('results');
        }
    };

    const downloadCertificate = () => {
        document.execCommand('copy'); // Simulate download by copying to clipboard
        alert('Certificate download initiated! (In a real app, a file would download)');
    };

    const resetModuleForRetry = async () => {
        if (!currentModule) return;
        const updatedModule = {
            ...currentModule,
            status: 'started',
            assignments: {}, // Reset assignments
            quizzes: [],
            finalTestScore: 0,
            certificateIssued: false,
            lastUpdated: new Date().toISOString()
        };
        setCurrentModule(updatedModule);
        await updateModuleInFirestore(currentModule.id, updatedModule);
        setAppPhase('assignment'); // Go back to assignment start
        setCurrentAssignmentSectionIndex(0); // Reset assignment section
        setAssignmentResponses({}); // Clear responses
        setQuestions([]);
        setUserAnswers({});
        setScore(0);
        setShowCertificate(false);
        setUserName('');
        setErrorMessage('');
        setAssessmentMetrics(null);
        setLastScoreDetails(null);
    };

    // --- UI Rendering Logic ---
    const renderModuleSelect = () => (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold text-gray-800 text-center mb-6">Your Modules</h2>
            {modules.length === 0 ? (
                <p className="text-gray-600 text-center">No modules yet. Create your first one!</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {modules.map(module => (
                        <div
                            key={module.id}
                            onClick={() => selectModule(module)}
                            className="bg-blue-50 p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 cursor-pointer border-l-4 border-blue-500 flex flex-col justify-between"
                        >
                            <div>
                                <h3 className="text-xl font-semibold text-blue-800">{module.name}</h3>
                                <p className="text-sm text-gray-600 mt-1">Status: <span className={`font-medium ${module.status === 'completed' ? 'text-green-600' : module.status === 'needs_revisit' ? 'text-red-600' : 'text-blue-600'}`}>{module.status.replace(/_/g, ' ')}</span></p>
                                {module.finalTestScore > 0 && (
                                    <p className="text-sm text-gray-600">Last Score: <span className="font-medium text-purple-700">{module.finalTestScore.toFixed(2)}%</span></p>
                                )}
                            </div>
                            <button className="mt-4 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors duration-200">
                                Open Module
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className="mt-8 pt-6 border-t border-gray-200">
                <h3 className="text-2xl font-bold text-gray-800 mb-4">Create New Module</h3>
                <div className="flex flex-col sm:flex-row gap-4">
                    <input
                        type="text"
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                        placeholder="e.g., 'Introduction to C#', 'Quantum Field Theory'"
                        className="flex-grow p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-lg"
                    />
                    <button
                        onClick={createNewModule}
                        disabled={loading}
                        className="bg-green-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg hover:bg-green-700 transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                    >
                        {loading ? 'Creating...' : 'Create Module'}
                    </button>
                </div>
            </div>
        </div>
    );

    const renderResourcesPhase = () => (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold text-gray-800 text-center mb-6">Module: {currentModule?.name} - Resources</h2>
            <p className="text-gray-700 text-lg text-center">
                Here, you can add your learning resources (PDFs, videos, websites) or use the academy's "Teacher's Picks."
                All assessments will be based on these designated materials.
            </p>

            <div className="p-6 bg-blue-50 rounded-lg shadow-inner">
                <h3 className="text-2xl font-bold text-blue-800 mb-4">Your Added Resources</h3>
                {currentModule?.resources.length === 0 ? (
                    <p className="text-gray-600">No resources added yet. Add some below!</p>
                ) : (
                    <ul className="list-disc list-inside space-y-2 text-gray-700">
                        {currentModule?.resources.map((res, index) => (
                            <li key={index} className="break-words">{res}</li>
                        ))}
                    </ul>
                )}
                <div className="mt-6 flex flex-col sm:flex-row gap-4">
                    <input
                        type="text"
                        value={resourceInput}
                        onChange={(e) => setResourceInput(e.target.value)}
                        placeholder="Add a resource URL or description"
                        className="flex-grow p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-lg"
                    />
                    <button
                        onClick={addResource}
                        className="bg-purple-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg hover:bg-purple-700 transition-all duration-300 transform hover:scale-105 text-lg"
                    >
                        Add Resource
                    </button>
                </div>
            </div>

            <div className="p-6 bg-green-50 rounded-lg shadow-inner">
                <h3 className="text-2xl font-bold text-green-800 mb-4">Teacher's Picks (AI Generated)</h3>
                {loading ? (
                    <p className="text-green-700 text-lg text-center">Generating teacher's picks...</p>
                ) : teacherPicks.length === 0 ? (
                    <p className="text-gray-600">No teacher's picks available. Try generating module content again.</p>
                ) : (
                    <ul className="list-disc list-inside space-y-2 text-gray-700">
                        {teacherPicks.map((pick, index) => (
                            <li key={index} className="break-words">
                                {pick.url ? (
                                    <a href={pick.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                        {pick.title}
                                    </a>
                                ) : (
                                    <span>{pick.title}</span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <div className="flex justify-center gap-4 mt-8">
                <button
                    onClick={() => setAppPhase('assignment')}
                    className="bg-blue-600 text-white font-bold py-3 px-8 rounded-lg shadow-lg hover:bg-blue-700 transition-all duration-300 transform hover:scale-105 text-lg"
                >
                    Proceed to Assignment
                </button>
                <button
                    onClick={() => setAppPhase('moduleSelect')}
                    className="bg-gray-300 text-gray-800 font-bold py-3 px-8 rounded-lg shadow-md hover:bg-gray-400 transition-all duration-200 transform hover:scale-105 text-lg"
                >
                    Back to Modules
                </button>
            </div>
        </div>
    );

    const renderAssignmentPhase = () => {
        if (!currentModule || (!assignmentContent && !loading)) { // Show "No assignment" only if not loading
            return (
                <div className="text-center p-8">
                    <p className="text-red-600 text-lg">No assignment loaded for this module.</p>
                    <button
                        onClick={() => setAppPhase('moduleSelect')}
                        className="mt-4 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700"
                    >
                        Back to Modules
                    </button>
                </div>
            );
        }

        if (loading || !assignmentContent) { // Show loading if content is null AND loading is true
            return (
                <div className="text-center p-8">
                    <p className="text-blue-600 text-xl font-semibold">Loading assignment content...</p>
                    <p className="text-gray-600 mt-2">This might take a moment as the AI generates it.</p>
                </div>
            );
        }

        const currentSection = assignmentContent.sections[currentAssignmentSectionIndex];
        const isFirstSection = currentAssignmentSectionIndex === 0;
        const isLastSection = currentAssignmentSectionIndex === assignmentContent.sections.length - 1;

        return (
            <div className="space-y-6">
                <h2 className="text-3xl font-bold text-gray-800 text-center mb-6">Module: {currentModule?.name} - Assignment</h2>
                <p className="text-gray-700 text-lg text-center">
                    **{assignmentContent.title}** (Total Marks: {assignmentContent.total_marks})
                </p>
                <p className="text-gray-600 text-base text-center mb-4">
                    {assignmentContent.scenario.description}
                </p>

                {/* Removed redundant loading check here as it's handled above */}
                <div className="p-6 bg-yellow-50 rounded-lg shadow-inner space-y-6">
                    <h3 className="text-2xl font-bold text-yellow-800 text-center mb-4">
                        {currentSection.section_title} ({currentSection.marks} Marks)
                    </h3>
                    <p className="text-gray-700 text-lg font-semibold">{currentSection.sub_scenario.title}</p>
                    <p className="text-gray-600 text-base mb-4">{currentSection.sub_scenario.description}</p>

                    {currentSection.tasks.map((task) => (
                        <div key={task.task_id} className="mb-4 p-4 border border-yellow-200 rounded-lg bg-white shadow-sm">
                            <p className="text-lg font-semibold text-gray-900 mb-2">
                                {task.task_id}. {task.task_description} ({task.marks} Marks)
                            </p>
                            {task.type === 'text_input' && (
                                <textarea
                                    className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 outline-none text-base font-mono"
                                    rows="6"
                                    placeholder={`Enter your response for Task ${task.task_id} here...`}
                                    value={assignmentResponses[currentSection.section_id]?.[task.task_id] || ''}
                                    onChange={(e) => handleAssignmentResponseChange(currentSection.section_id, task.task_id, e.target.value)}
                                ></textarea>
                            )}
                            {task.type === 'code_input' && (
                                <textarea
                                    className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 outline-none text-base font-mono bg-gray-900 text-green-400"
                                    rows="10"
                                    placeholder={`Write your ${task.language || 'Python'} code for Task ${task.task_id} here...`}
                                    value={assignmentResponses[currentSection.section_id]?.[task.task_id] || ''}
                                    onChange={(e) => handleAssignmentResponseChange(currentSection.section_id, task.task_id, e.target.value)}
                                ></textarea>
                            )}
                        </div>
                    ))}
                </div>

                <div className="flex justify-between gap-4 mt-8">
                    <button
                        onClick={goToPreviousAssignmentSection}
                        disabled={isFirstSection}
                        className="bg-gray-300 text-gray-800 font-bold py-3 px-6 rounded-lg shadow-md hover:bg-gray-400 transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                    >
                        Previous Section
                    </button>
                    {isLastSection ? (
                        <button
                            onClick={submitAssignment}
                            className="bg-green-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg hover:bg-green-700 transition-all duration-300 transform hover:scale-105 text-lg"
                        >
                            Submit Assignment
                        </button>
                    ) : (
                        <button
                            onClick={goToNextAssignmentSection}
                            className="bg-blue-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg hover:bg-blue-700 transition-all duration-300 transform hover:scale-105 text-lg"
                        >
                            Next Section
                        </button>
                    )}
                </div>

                <div className="mt-8 pt-6 border-t border-gray-200">
                    <h3 className="text-2xl font-bold text-gray-800 mb-4">Resources for this Assignment</h3>
                    {assignmentContent.resources.length === 0 ? (
                        <p className="text-gray-600">No specific resources provided for this assignment.</p>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {assignmentContent.resources.map((res, index) => (
                                <div key={index} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                                    <p className="font-semibold text-blue-800">{res.title}</p>
                                    <p className="text-sm text-gray-600">Category: {res.category}</p>
                                    <a href={res.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-sm break-words">
                                        {res.url}
                                    </a>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderQuizPhase = () => (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold text-gray-800 text-center mb-6">Module: {currentModule?.name} - Quiz</h2>
            <p className="text-gray-700 text-lg text-center">
                Test your understanding with a practice quiz based on the module resources.
            </p>

            <div className="p-6 bg-purple-50 rounded-lg shadow-inner">
                <h3 className="text-2xl font-bold text-purple-800 mb-4">Quiz Details (AI Metrics)</h3>
                {assessmentMetrics && (
                    <ul className="list-disc list-inside space-y-2 text-gray-700">
                        <li>**Practicality/Theoreticity:** {assessmentMetrics.practicalityTheoreticity}</li>
                        <li>**Predictability:** {assessmentMetrics.predictability}</li>
                        <li>**Difficulty:** {assessmentMetrics.difficulty}</li>
                        <li>**Alignment:** {assessmentMetrics.alignment}</li>
                        <li>**Learning Time:** {assessmentMetrics.learningTime}</li>
                        <li>**Proficiency Required:** {assessmentMetrics.proficiencyRequired}</li>
                    </ul>
                )}
                <button
                    onClick={() => generateTest('quiz')}
                    disabled={loading}
                    className="mt-6 bg-purple-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg hover:bg-purple-700 transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                >
                    {loading ? 'Generating Quiz...' : 'Generate Quiz'}
                </button>
            </div>

            {errorMessage && (
                <p className="text-red-600 text-md mt-4 text-center">{errorMessage}</p>
            )}

            {questions.length > 0 && (
                <div className="p-6 bg-gray-50 rounded-lg shadow-md">
                    <h3 className="text-2xl font-bold text-gray-800 mb-6 text-center">Your Quiz Questions</h3>
                    {questions.map((q, qIndex) => (
                        <div key={qIndex} className="mb-6 p-5 border border-gray-200 rounded-lg bg-white shadow-sm hover:shadow-md transition-shadow duration-200">
                            <p className="text-lg font-semibold text-gray-900 mb-3">{qIndex + 1}. {q.question}</p>
                            <div className="space-y-2">
                                {Object.entries(q.options).map(([optionKey, optionValue]) => (
                                    <label key={optionKey} className="flex items-center text-gray-700 cursor-pointer hover:bg-blue-50 p-2 rounded-md transition-colors duration-150">
                                        <input
                                            type="radio"
                                            name={`quiz-question-${qIndex}`}
                                            value={optionKey}
                                            checked={userAnswers[qIndex] === optionKey}
                                            onChange={() => handleAnswerChange(qIndex, optionKey)}
                                            className="form-radio h-5 w-5 text-blue-600 border-gray-300 focus:ring-blue-500"
                                        />
                                        <span className="ml-3 text-base">{optionKey}. {optionValue}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    ))}
                    <div className="flex justify-center mt-8">
                        <button
                            onClick={() => submitTest('quiz')}
                            className="bg-gradient-to-r from-green-500 to-teal-600 text-white font-bold py-3 px-8 rounded-lg shadow-lg hover:from-green-600 hover:to-teal-700 transition-all duration-300 transform hover:scale-105 text-lg"
                        >
                            Submit Quiz
                        </button>
                    </div>
                </div>
            )}

            <div className="flex justify-center gap-4 mt-8">
                <button
                    onClick={() => setAppPhase('finalTest')}
                    disabled={!currentModule?.quizzes.some(q => q.score >= 80)}
                    className="bg-blue-600 text-white font-bold py-3 px-8 rounded-lg shadow-lg hover:bg-blue-700 transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                >
                    Proceed to Final Test
                </button>
                <button
                    onClick={() => setAppPhase('assignment')}
                    className="bg-gray-300 text-gray-800 font-bold py-3 px-8 rounded-lg shadow-md hover:bg-gray-400 transition-all duration-200 transform hover:scale-105 text-lg"
                >
                    Back to Assignment
                </button>
            </div>
        </div>
    );

    const renderFinalTestPhase = () => (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold text-gray-800 text-center mb-6">Module: {currentModule?.name} - Final Test</h2>
            <p className="text-gray-700 text-lg text-center">
                This is your comprehensive final assessment for the module.
            </p>

            <div className="p-6 bg-red-50 rounded-lg shadow-inner">
                <h3 className="text-2xl font-bold text-red-800 mb-4">Final Test Details (AI Metrics)</h3>
                {assessmentMetrics && (
                    <ul className="list-disc list-inside space-y-2 text-gray-700">
                        <li>**Practicality/Theoreticity:** {assessmentMetrics.practicalityTheoreticity}</li>
                        <li>**Predictability:** {assessmentMetrics.predictability}</li>
                        <li>**Difficulty:** {assessmentMetrics.difficulty}</li>
                        <li>**Alignment:** {assessmentMetrics.alignment}</li>
                        <li>**Learning Time:** {assessmentMetrics.learningTime}</li>
                        <li>**Proficiency Required:** {assessmentMetrics.proficiencyRequired}</li>
                    </ul>
                )}
                <button
                    onClick={() => generateTest('finalTest')}
                    disabled={loading}
                    className="mt-6 bg-red-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg hover:bg-red-700 transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                >
                    {loading ? 'Generating Test...' : 'Generate Final Test'}
                </button>
            </div>

            {errorMessage && (
                <p className="text-red-600 text-md mt-4 text-center">{errorMessage}</p>
            )}

            {questions.length > 0 && (
                <div className="p-6 bg-gray-50 rounded-lg shadow-md">
                    <h3 className="text-2xl font-bold text-gray-800 mb-6 text-center">Your Final Test Questions</h3>
                    {questions.map((q, qIndex) => (
                        <div key={qIndex} className="mb-6 p-5 border border-gray-200 rounded-lg bg-white shadow-sm hover:shadow-md transition-shadow duration-200">
                            <p className="text-lg font-semibold text-gray-900 mb-3">{qIndex + 1}. {q.question}</p>
                            <div className="space-y-2">
                                {Object.entries(q.options).map(([optionKey, optionValue]) => (
                                    <label key={optionKey} className="flex items-center text-gray-700 cursor-pointer hover:bg-blue-50 p-2 rounded-md transition-colors duration-150">
                                        <input
                                            type="radio"
                                            name={`final-test-question-${qIndex}`}
                                            value={optionKey}
                                            checked={userAnswers[qIndex] === optionKey}
                                            onChange={() => handleAnswerChange(qIndex, optionKey)}
                                            className="form-radio h-5 w-5 text-blue-600 border-gray-300 focus:ring-blue-500"
                                        />
                                        <span className="ml-3 text-base">{optionKey}. {optionValue}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    ))}
                    <div className="flex justify-center mt-8">
                        <button
                            onClick={() => submitTest('finalTest')}
                            className="bg-gradient-to-r from-green-500 to-teal-600 text-white font-bold py-3 px-8 rounded-lg shadow-lg hover:from-green-600 hover:to-teal-700 transition-all duration-300 transform hover:scale-105 text-lg"
                        >
                            Submit Final Test
                        </button>
                    </div>
                </div>
            )}

            <div className="flex justify-center gap-4 mt-8">
                <button
                    onClick={() => setAppPhase('quiz')}
                    className="bg-gray-300 text-gray-800 font-bold py-3 px-8 rounded-lg shadow-md hover:bg-gray-400 transition-all duration-200 transform hover:scale-105 text-lg"
                >
                    Back to Quiz
                </button>
            </div>
        </div>
    );

    const renderResultsPhase = () => (
        <div className="p-8 bg-gradient-to-br from-yellow-50 to-orange-100 rounded-xl shadow-inner border-4 border-yellow-300 text-center relative overflow-hidden">
            {/* Decorative elements */}
            <div className="absolute top-0 left-0 w-full h-full bg-contain bg-no-repeat bg-center opacity-10" style={{ backgroundImage: "url('https://placehold.co/600x400/FFF8DC/DAA520?text=Certificate+Seal')" }}></div>
            <div className="relative z-10">
                <h2 className="text-5xl font-extrabold text-yellow-800 mb-4 font-serif">Module Completion Results</h2>
                <p className="text-xl text-gray-700 mb-6">For module: <span className="font-semibold text-purple-700">"{currentModule?.name}"</span></p>

                {lastScoreDetails && (
                    <>
                        <p className="text-2xl font-bold text-gray-800 mb-4">
                            Final Score: <span className={`${lastScoreDetails.score >= 80 ? 'text-green-600' : 'text-red-600'}`}>{lastScoreDetails.score.toFixed(2)}%</span>
                        </p>
                        <p className="text-lg text-gray-700 mb-6">{lastScoreDetails.comment}</p>

                        {lastScoreDetails.certificateIssued && (
                            <>
                                <p className="text-xl text-gray-700 mb-4">Enter your name for the certificate:</p>
                                <input
                                    type="text"
                                    value={userName}
                                    onChange={(e) => setUserName(e.target.value)}
                                    placeholder="Your Name"
                                    className="text-4xl font-bold text-blue-700 border-b-2 border-blue-400 bg-transparent outline-none text-center mb-6 p-2 w-full max-w-sm mx-auto focus:border-blue-600 transition-colors duration-200"
                                />
                                <button
                                    onClick={downloadCertificate}
                                    className="bg-gradient-to-r from-blue-500 to-purple-500 text-white font-bold py-3 px-6 rounded-lg shadow-md hover:from-blue-600 hover:to-purple-600 transition-all duration-200 transform hover:scale-105 text-lg"
                                >
                                    Download Certificate
                                </button>
                            </>
                        )}
                        {!lastScoreDetails.certificateIssued && (
                            <button
                                onClick={resetModuleForRetry}
                                className="bg-red-600 text-white font-bold py-3 px-6 rounded-lg shadow-md hover:bg-red-700 transition-all duration-200 transform hover:scale-105 text-lg"
                            >
                                Retry Module
                            </button>
                        )}
                    </>
                )}

                <div className="flex justify-center gap-4 mt-8">
                    <button
                        onClick={() => {
                            setAppPhase('moduleSelect');
                            setCurrentModule(null);
                            setQuestions([]);
                            setUserAnswers({});
                            setScore(0);
                            setShowCertificate(false);
                            setUserName('');
                            setErrorMessage('');
                            setAssessmentMetrics(null);
                            setLastScoreDetails(null);
                            setCurrentAssignmentSectionIndex(0); // Reset assignment section
                            setAssignmentResponses({}); // Clear responses
                        }}
                        className="bg-gray-300 text-gray-800 font-bold py-3 px-6 rounded-lg shadow-md hover:bg-gray-400 transition-all duration-200 transform hover:scale-105 text-lg"
                    >
                        Back to All Modules
                    </button>
                </div>
            </div>
        </div>
    );

    const renderContent = () => {
        if (!isAuthReady) {
            return (
                <div className="text-center p-8">
                    <p className="text-xl text-gray-700 font-semibold">Initializing Academy...</p>
                    {errorMessage && <p className="text-red-600 mt-4">{errorMessage}</p>}
                    <p className="text-sm text-gray-500 mt-2">Please ensure your Firebase configuration and API keys are correctly set in .env</p>
                </div>
            );
        }

        if (errorMessage && !loading) {
            return (
                <div className="text-center p-8 bg-red-100 rounded-lg shadow-md">
                    <p className="text-red-700 font-bold text-2xl mb-4">Error!</p>
                    <p className="text-red-600 text-lg">{errorMessage}</p>
                    <button
                        onClick={() => setErrorMessage('')}
                        className="mt-6 bg-red-500 text-white py-2 px-4 rounded-lg hover:bg-red-600 transition-colors"
                    >
                        Dismiss
                    </button>
                </div>
            );
        }

        switch (appPhase) {
            case 'moduleSelect':
                return renderModuleSelect();
            case 'resources':
                return renderResourcesPhase();
            case 'assignment':
                return renderAssignmentPhase();
            case 'quiz':
                return renderQuizPhase();
            case 'finalTest':
                return renderFinalTestPhase();
            case 'results':
                return renderResultsPhase();
            default:
                return renderModuleSelect();
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-100 to-purple-200 flex items-center justify-center p-4 font-sans">
            <div className="bg-white rounded-xl shadow-2xl p-8 md:p-12 w-full max-w-3xl transform transition-all duration-300 hover:scale-[1.01]">
                <h1 className="text-4xl font-extrabold text-center text-gray-800 mb-8">
                    <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600">
                        Quantum Leap AI Education Academy
                    </span>
                </h1>
                {userId && (
                    <p className="text-sm text-gray-500 text-center mb-4">User ID: {userId}</p>
                )}
                {renderContent()}
            </div>
        </div>
    );
};

export default App;
