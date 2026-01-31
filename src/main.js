import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { gsap } from 'gsap';

// Get the existing canvas from the DOM
const canvas = document.querySelector('canvas');

// Overlay instruction in the top-left corner with subtle parallax effect

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

// Camera
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 2, 5);

// Store original camera position for return
const originalCameraPos = { x: 0, y: 2, z: 5 };
const originalCameraLook = { x: 0, y: 1, z: 0 };

// Renderer
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;

// Orbit Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 2;
controls.maxDistance = 20;

// State
let roomModel = null;
let computerMesh = null;
let isZoomedIn = false;
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();

// PMREM Generator for environment maps
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

// Load HDRI environment
const rgbeLoader = new RGBELoader();
rgbeLoader.load(
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',
  (texture) => {
    const envMap = pmremGenerator.fromEquirectangular(texture).texture;
    scene.environment = envMap;
    
    texture.dispose();
    pmremGenerator.dispose();
  },
  undefined,
  (error) => {
    console.warn('HDRI failed to load, using fallback environment:', error);
    const envMap = pmremGenerator.fromScene(new THREE.Scene()).texture;
    scene.environment = envMap;
  }
);

// Load room model
const loader = new GLTFLoader();
loader.load(
  '/room.glb',
  (gltf) => {
    roomModel = gltf.scene;
    
    // Center and scale the model
    const box = new THREE.Box3().setFromObject(roomModel);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 3 / maxDim;
    
    roomModel.scale.multiplyScalar(scale);
    roomModel.position.sub(center.multiplyScalar(scale));
    roomModel.position.y = -1;
    
    scene.add(roomModel);
    
    // Find computer mesh on table (prioritize by position and characteristics)
    const potentialComputers = [];
    
    roomModel.traverse((child) => {
      if (child.isMesh) {
        const box = new THREE.Box3().setFromObject(child);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const name = child.name.toLowerCase();
        
        // Check if it's at table height (typically 0.5 to 1.5 units above ground)
        const isAtTableHeight = center.y > 0.5 && center.y < 1.8;
        
        // Check if it has screen-like dimensions (wider than tall, or reasonable screen size)
        const isScreenLike = (size.x > size.y && size.x > 0.3) || 
                            (size.z > size.y && size.z > 0.3) ||
                            (size.x > 0.2 && size.y > 0.2 && size.z < 0.1);
        
        // Check name for computer-related keywords
        const hasComputerName = name.includes('computer') || 
                               name.includes('monitor') || 
                               name.includes('screen') || 
                               name.includes('pc') || 
                               name.includes('laptop') ||
                               name.includes('desktop') ||
                               name.includes('display');
        
        // Score potential computers
        if (isAtTableHeight && (isScreenLike || hasComputerName)) {
          let score = 0;
          if (hasComputerName) score += 10;
          if (isScreenLike) score += 5;
          if (center.y > 0.7 && center.y < 1.3) score += 3; // Ideal table height
          if (size.x > 0.4 || size.z > 0.4) score += 2; // Good size
          
          potentialComputers.push({ mesh: child, score, center, size });
        }
      }
    });
    
    // Sort by score and pick the best match
    if (potentialComputers.length > 0) {
      potentialComputers.sort((a, b) => b.score - a.score);
      computerMesh = potentialComputers[0].mesh;
      console.log('Computer on table found:', computerMesh.name, 'Score:', potentialComputers[0].score);
      console.log('Position:', potentialComputers[0].center);
    } else {
      // Fallback: find any mesh at table height
      roomModel.traverse((child) => {
        if (child.isMesh && !computerMesh) {
          const box = new THREE.Box3().setFromObject(child);
          const center = box.getCenter(new THREE.Vector3());
          if (center.y > 0.6 && center.y < 1.5) {
            computerMesh = child;
            console.log('Fallback: Using mesh at table height:', child.name);
          }
        }
      });
    }
    
    // Make computer interactive (add outline or highlight)
    if (computerMesh) {
      computerMesh.userData.isComputer = true;
    }
  },
  (progress) => {
    console.log('Loading progress:', (progress.loaded / progress.total * 100) + '%');
  },
  (error) => {
    console.error('Error loading model:', error);
  }
);

// Mouse click handler
function onMouseClick(event) {
  if (isZoomedIn) return;
  
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  
  raycaster.setFromCamera(mouse, camera);
  
  if (roomModel) {
    const intersects = raycaster.intersectObject(roomModel, true);
    
    if (intersects.length > 0) {
      const clickedObject = intersects[0].object;
      
      // Check if clicked object or its parent is the computer
      let checkObject = clickedObject;
      while (checkObject) {
        if (checkObject.userData.isComputer || checkObject === computerMesh) {
          zoomToComputer(intersects[0].point);
          return;
        }
        checkObject = checkObject.parent;
      }
    }
  }
}

canvas.addEventListener('click', onMouseClick);

// Smooth camera zoom to computer
function zoomToComputer(targetPoint) {
  if (isZoomedIn) return;
  
  isZoomedIn = true;
  controls.enabled = false;
  
  // Get computer mesh bounding box to position camera straight in front
  if (computerMesh) {
    const box = new THREE.Box3().setFromObject(computerMesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    
    // Get the world position of the computer center
    const worldCenter = new THREE.Vector3();
    computerMesh.getWorldPosition(worldCenter);
    
    // Calculate direction from current camera to computer (to position camera in front)
    const cameraToComputer = new THREE.Vector3().subVectors(worldCenter, camera.position).normalize();
    
    // Position camera directly in front of the screen (straight on)
    // Move camera to be in front of the computer, looking straight at it
    const distance = 1.0; // Distance from screen
    const zoomPosition = {
      x: worldCenter.x - cameraToComputer.x * distance,
      y: worldCenter.y + 0.1, // Eye level, slightly above center
      z: worldCenter.z - cameraToComputer.z * distance
    };
    
    const zoomLookAt = {
      x: worldCenter.x,
      y: worldCenter.y,
      z: worldCenter.z
    };
    
    // Animate camera
    gsap.to(camera.position, {
      x: zoomPosition.x,
      y: zoomPosition.y,
      z: zoomPosition.z,
      duration: 1.5,
      ease: 'power2.inOut',
      onUpdate: () => {
        camera.lookAt(zoomLookAt.x, zoomLookAt.y, zoomLookAt.z);
      },
      onComplete: () => {
        showWindowsBootLoader();
      }
    });
  } else {
    // Fallback: position camera straight in front of click point
    const distance = 1.0;
    const direction = new THREE.Vector3().subVectors(camera.position, targetPoint).normalize();
    
    const zoomPosition = {
      x: targetPoint.x - direction.x * distance,
      y: targetPoint.y - direction.y * distance + 0.2,
      z: targetPoint.z - direction.z * distance
    };
    
    const zoomLookAt = {
      x: targetPoint.x,
      y: targetPoint.y,
      z: targetPoint.z
    };
    
    gsap.to(camera.position, {
      x: zoomPosition.x,
      y: zoomPosition.y,
      z: zoomPosition.z,
      duration: 1.5,
      ease: 'power2.inOut',
      onUpdate: () => {
        camera.lookAt(zoomLookAt.x, zoomLookAt.y, zoomLookAt.z);
      },
      onComplete: () => {
        showWindowsBootLoader();
      }
    });
  }
}

// Show Windows boot loader
function showWindowsBootLoader() {
  const bootLoader = document.createElement('div');
  bootLoader.id = 'windows-boot-loader';
  bootLoader.innerHTML = `
    <div class="boot-screen">
      <div class="boot-logo">
        <div class="windows-logo">
          <div class="window-pane"></div>
          <div class="window-pane"></div>
          <div class="window-pane"></div>
          <div class="window-pane"></div>
        </div>
      </div>
      <div class="boot-text">Starting Windows...</div>
      <div class="boot-progress">
        <div class="boot-progress-bar"></div>
      </div>
    </div>
  `;
  document.body.appendChild(bootLoader);
  
  // Animate boot progress
  gsap.to('.boot-progress-bar', {
    width: '100%',
    duration: 2,
    ease: 'power2.inOut',
    onComplete: () => {
      gsap.to('#windows-boot-loader', {
        opacity: 0,
        duration: 0.5,
        onComplete: () => {
          bootLoader.remove();
          showComputerOS();
        }
      });
    }
  });
}

// Show computer OS UI
function showComputerOS() {
  const osOverlay = document.getElementById('computer-os');
  if (osOverlay) {
    osOverlay.style.display = 'flex';
    gsap.fromTo(osOverlay, 
      { opacity: 0 },
      { opacity: 1, duration: 0.5, ease: 'power2.out' }
    );
    updateClock();
    setInterval(updateClock, 1000);
  }
}

// Update clock
function updateClock() {
  const clockElement = document.getElementById('clock');
  if (clockElement) {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    clockElement.textContent = `${hours}:${minutes}`;
  }
}

// Return to room view
function returnToRoom() {
  if (!isZoomedIn) return;
  
  isZoomedIn = false;
  
  const osOverlay = document.getElementById('computer-os');
  
  // First, fade out the desktop
  if (osOverlay) {
    gsap.to(osOverlay, {
      opacity: 0,
      duration: 0.3,
      onComplete: () => {
        // Close all windows
        openWindows.forEach((windowData, folderName) => {
          closeWindow(folderName);
        });
        
        // Hide the desktop completely
        osOverlay.style.display = 'none';
        
        // Then show shutdown animation
        showWindowsShutdown(() => {
          // Animate camera back
          gsap.to(camera.position, {
            x: originalCameraPos.x,
            y: originalCameraPos.y,
            z: originalCameraPos.z,
            duration: 1.5,
            ease: 'power2.inOut',
            onUpdate: () => {
              camera.lookAt(originalCameraLook.x, originalCameraLook.y, originalCameraLook.z);
            },
            onComplete: () => {
              controls.enabled = true;
            }
          });
        });
      }
    });
  } else {
    // Fallback if overlay not found
    showWindowsShutdown(() => {
      gsap.to(camera.position, {
        x: originalCameraPos.x,
        y: originalCameraPos.y,
        z: originalCameraPos.z,
        duration: 1.5,
        ease: 'power2.inOut',
        onUpdate: () => {
          camera.lookAt(originalCameraLook.x, originalCameraLook.y, originalCameraLook.z);
        },
        onComplete: () => {
          controls.enabled = true;
        }
      });
    });
  }
}

// Show Windows shutdown animation
function showWindowsShutdown(callback) {
  const shutdownScreen = document.createElement('div');
  shutdownScreen.id = 'windows-shutdown';
  shutdownScreen.innerHTML = `
    <div class="shutdown-screen">
      <div class="shutdown-text">Shutting down...</div>
    </div>
  `;
  document.body.appendChild(shutdownScreen);
  
  // Show shutdown screen immediately (it's already black, so it will cover everything)
  shutdownScreen.style.opacity = '1';
  
  // Wait a bit, then fade out
  setTimeout(() => {
    gsap.to(shutdownScreen, {
      opacity: 0,
      duration: 0.8,
      onComplete: () => {
        shutdownScreen.remove();
        if (callback) callback();
      }
    });
  }, 1200);
}

// Make returnToRoom globally accessible
window.returnToRoom = returnToRoom;

// Download resume
window.downloadResume = function() {
  const link = document.createElement('a');
  link.href = '/resume.png';
  link.download = 'Aman_Kumar_Resume.png';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// Open resume in fullscreen
window.downloadResume = function() {
  const link = document.createElement('a');
  link.href = '/AmanKumarResume.pdf';
  link.download = 'Aman_Kumar_Resume.pdf';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

window.openResumeFullscreen = function() {
  // Open the resume PDF in a new browser tab
  window.open('/AmanKumarResume.pdf', '_blank');
};

// Folder icon mappings matching index.html (for use in desktop, etc.)
const folderIcons = {
  about: '📁',
  resume: '📄',
  projects: `<img src="/project.png" alt="Projects" style="width:40px; height:40px; display:block; margin:0 auto; margin-top:20px;">`,
  skills: '⚡',
  contact: `<img src="/contact.png" alt="Contact" style="width:40px; height:40px; display:block; margin:0 auto; margin-top:20px;">`,
  spotify: `<img src="/spotify.png" alt="Spotify" style="width:40px; height:40px; display:block; margin:0 auto; margin-top:20px;">`
};




// Folder content data
const folderContent = {
  about: {
    title: 'About Me',
    content: `
      <div class="folder-section">
        <h2>About Me</h2>
        <p>Hello! I'm <strong>Aman Kumar</strong>, a passionate Computer Science student and full-stack developer.</p>
        <p>I'm currently pursuing my Bachelor of Technology in Computer Science at Seth Jai Parkash Mukand Lal Institute of Engineering and Technology, Yamuna Nagar, Haryana (2022-2026).</p>
        <p>I love building innovative web applications and bringing ideas to life through code. With expertise in the MERN stack and modern web technologies, I create engaging digital experiences that solve real-world problems.</p>
        <p>When I'm not coding, you can find me exploring new technologies, contributing to open-source projects (including Hacktoberfest 2025), organizing tournaments, or working on personal creative endeavors.</p>
        <h3 style="color: #64b5f6; margin-top: 30px;">Relevant Coursework</h3>
        <ul>
          <li>Data Structures</li>
          <li>MERN DEVELOPMENT</li>
          <li>Database Management</li>
          <li>Object-Oriented Programming (OOPs)</li>
          <li>Computer Networks</li>
        </ul>
      </div>
    `
  },
  resume: {
    title: 'Resume',
    content: `
      <div class="folder-section" style="text-align: center;">
        <h2>Resume</h2>
        <div style="margin-top: 20px; display: flex; flex-direction: column; align-items: center; gap: 16px;">
          <img src="/resume.png" 
               alt="Aman Kumar Resume" 
               id="resume-image" 
               style="max-width: 100%; height: auto; border: 2px solid rgba(100, 181, 246, 0.3); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); cursor: pointer; transition: transform 0.2s;"
               onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjEwMDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJncmFkIiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEwMCUiIHkyPSIxMDAlIj48c3RvcCBvZmZzZXQ9IjAlIiBzdHlsZT0ic3RvcC1jb2xvcjojMWExYTJlO3N0b3Atb3BhY2l0eToxIi8+PHN0b3Agb2Zmc2V0PSIxMDAlIiBzdHlsZT0ic3RvcC1jb2xvcjojMTYyMTNlO3N0b3Atb3BhY2l0eToxIi8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmFkKSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMjQiIGZpbGw9IiM2NGI1ZjYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5SZXN1bWUgSW1hZ2UgTm90IEZvdW5kPC90ZXh0Pjx0ZXh0IHg9IjUwJSIgeT0iNTUlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTYiIGZpbGw9IiNiMGIwYjAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5QbGVhc2UgYWRkIHJlc3VtZS5wbmcgdG8gcHVibGljIGZvbGRlcjwvdGV4dD48L3N2Zz4='"
               onmouseover="this.style.transform='scale(1.02)'"
               onmouseout="this.style.transform='scale(1)'"
               onclick="openResumeFullscreen()" />
          <button onclick="downloadResume()" style="padding: 12px 24px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; border-radius: 8px; color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);">
            📥 Download Resume
          </button>
        </div>
        <p style="margin-top: 8px; color: #b0b0b0; font-size: 14px;">Click on the resume to view in fullscreen</p>
      </div>
    `
  },
  projects: {
    title: 'Projects',
    content: `
      <div class="folder-section">
        <h2>Projects</h2>
        <div class="project-card">
          <h3>SigmaGPT — AI Chatbot Web App</h3>
          <p><strong>Technologies:</strong> MERN Stack, GeminiAI API</p>
          <p><strong>Date:</strong> September 2025</p>
          <p>An intelligent AI-powered chatbot web application built with the MERN stack, integrated with Google's GeminiAI API for natural language processing and conversational capabilities.</p>
          <p style="margin-top: 12px;">
            <a href="https://sigma-gpt-wqqi.vercel.app/" target="_blank" style="color: #64b5f6; text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
              <span>🌐</span> <span>Visit Live Site</span>
            </a>
          </p>
        </div>
        <div class="project-card">
          <h3>WanderLust — Travel Listing Web Application</h3>
          <p><strong>Technologies:</strong> Node.js, Express.js, MongoDB, Mongoose, EJS</p>
          <p><strong>Date:</strong> June 2025</p>
          <p>A full-stack travel listing platform where users can browse, create, and manage travel destinations. Features include user authentication, CRUD operations, and dynamic content rendering with EJS templates.</p>
          <p style="margin-top: 12px;">
            <a href="https://wanderlust-wkeg.onrender.com/listings" target="_blank" style="color: #64b5f6; text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
              <span>🌐</span> <span>Visit Live Site</span>
            </a>
          </p>
        </div>
        <div class="project-card">
          <h3>Simon Says Game</h3>
          <p><strong>Technologies:</strong> HTML, CSS, JavaScript, DOM Manipulation</p>
          <p><strong>Date:</strong> October 2024</p>
          <p>An interactive memory game where players follow sequences of colors and sounds. Built with vanilla JavaScript and DOM manipulation for a smooth, responsive gaming experience.</p>
        </div>
        <div class="project-card">
          <h3>Digital Clock Web App</h3>
          <p><strong>Technologies:</strong> HTML, CSS, JavaScript, DOM Manipulation</p>
          <p><strong>Date:</strong> August 2024</p>
          <p>A real-time digital clock web application with a modern, clean interface. Features live time updates and responsive design using vanilla JavaScript.</p>
        </div>
        <div class="project-card" style="background: rgba(100, 181, 246, 0.1); border-color: rgba(100, 181, 246, 0.5);">
          <h3>3D Interactive Portfolio</h3>
          <p><strong>Technologies:</strong> Three.js, JavaScript, HTML5, CSS3</p>
          <p><strong>Date:</strong> Current</p>
          <p>An immersive 3D portfolio website featuring interactive room navigation, computer interface interactions, and a desktop OS experience. Built with Three.js for 3D graphics and modern web technologies.</p>
        </div>
      </div>
    `
  },
  skills: {
    title: 'Skills',
    content: `
      <div class="folder-section">
        <h2>Technical Skills</h2>
        <h3 style="color: #64b5f6; margin-top: 20px; margin-bottom: 15px;">Programming Languages</h3>
        <div class="skill-grid">
          <div class="skill-item">
            <h3>Java</h3>
          </div>
          <div class="skill-item">
            <h3>JavaScript</h3>
          </div>
          <div class="skill-item">
            <h3>HTML5</h3>
          </div>
          <div class="skill-item">
            <h3>CSS3</h3>
          </div>
        </div>
        <h3 style="color: #64b5f6; margin-top: 30px; margin-bottom: 15px;">Technologies & Frameworks</h3>
        <div class="skill-grid">
          <div class="skill-item">
            <h3>MERN Stack</h3>
            
          </div>
          <div class="skill-item">
            <h3>Node.js</h3>
          </div>
          <div class="skill-item">
            <h3>Express.js</h3>
          </div>
          <div class="skill-item">
            <h3>Bootstrap</h3>
          </div>
          <div class="skill-item">
            <h3>EJS</h3>
          </div>
        </div>
        <h3 style="color: #64b5f6; margin-top: 30px; margin-bottom: 15px;">Developer Tools</h3>
        <div class="skill-grid">
          <div class="skill-item">
            <h3>Docker</h3>
          </div>
          <div class="skill-item">
            <h3>Git</h3>
          </div>
          <div class="skill-item">
            <h3>GitHub</h3>
          </div>
          <div class="skill-item">
            <h3>VS Code</h3>
          </div>
        </div>
      </div>
    `
  },
  contact: {
    title: 'Contact Me',
    content: `
      <div class="folder-section">
        <h2>Contact Me</h2>
        <div class="contact-info">
          <div class="contact-item">
            <span style="font-size: 24px;">📧</span>
            <a href="mailto:amansaini21892@gmail.com">amansaini21892@gmail.com</a>
          </div>
          <div class="contact-item">
            <span style="font-size: 24px;">📱</span>
            <a href="tel:+919350910136">+91 9350910136</a>
          </div>
          <div class="contact-item">
            <span style="font-size: 24px;">💼</span>
            <a href="https://www.linkedin.com/in/aman-kumar-ak004/" target="_blank">LinkedIn Profile</a>
          </div>
          <div class="contact-item">
            <span style="font-size: 24px;">🐙</span>
            <a href="https://github.com/AMANkumar0004" target="_blank">GitHub Profile</a>
          </div>
        </div>
        <div style="margin-top: 40px; padding: 20px; background: rgba(100, 181, 246, 0.1); border-radius: 10px; border-left: 4px solid #64b5f6;">
          <h3 style="color: #64b5f6; margin-bottom: 15px;">Open Source Contribution</h3>
          <p><strong>Hacktoberfest 2025</strong> - Open Source Contributor (October 2025, Remote)</p>
          <p style="margin-top: 10px; color: #b0b0b0;">Actively contributing to open-source projects and participating in the global Hacktoberfest event.</p>
        </div>
      </div>
    `
  }
};

// Window management
let openWindows = new Map();
let zIndexCounter = 1000;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let currentDraggedWindow = null;

// Create a window for a folder
function createWindow(folderName) {
  const folderData = folderContent[folderName];
  if (!folderData) return;
  
  // Check if window already exists
  if (openWindows.has(folderName)) {
    focusWindow(folderName);
    return;
  }
  
  const windowContainer = document.getElementById('window-container');
  if (!windowContainer) return;
  
  const windowId = `window-${folderName}`;
  const windowElement = document.createElement('div');
  windowElement.className = 'window';
  windowElement.id = windowId;
  windowElement.style.zIndex = zIndexCounter++;
  
  // Window header
  const header = document.createElement('div');
  header.className = 'window-header';
  
  const title = document.createElement('div');
  title.className = 'window-title';
  const iconMap = {
    about: '📁',
    resume: '📄',
    projects: '💼',
    skills: '⚡',
    contact: '📧'
  };
  title.innerHTML = `<span class="window-title-icon">${iconMap[folderName] || '📁'}</span> ${folderData.title}`;
  
  const controls = document.createElement('div');
  controls.className = 'window-controls';
  
  const minimizeBtn = document.createElement('button');
  minimizeBtn.className = 'window-control window-minimize';
  minimizeBtn.innerHTML = '−';
  minimizeBtn.onclick = () => minimizeWindow(folderName);
  
  const maximizeBtn = document.createElement('button');
  maximizeBtn.className = 'window-control window-maximize';
  maximizeBtn.innerHTML = '□';
  maximizeBtn.onclick = () => maximizeWindow(folderName);
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'window-control window-close';
  closeBtn.innerHTML = '×';
  closeBtn.onclick = () => closeWindow(folderName);
  
  controls.appendChild(minimizeBtn);
  controls.appendChild(maximizeBtn);
  controls.appendChild(closeBtn);
  
  header.appendChild(title);
  header.appendChild(controls);
  
  // Window content
  const content = document.createElement('div');
  content.className = 'window-content';
  content.innerHTML = folderData.content;
  
  windowElement.appendChild(header);
  windowElement.appendChild(content);
  
  // Position window - open fullscreen by default
  windowElement.style.width = 'calc(100% - 40px)';
  windowElement.style.height = 'calc(100% - 100px)';
  windowElement.style.left = '20px';
  windowElement.style.top = '20px';
  
  windowContainer.appendChild(windowElement);
  
  // Make window draggable
  makeWindowDraggable(windowElement, header);
  
  // Store window reference
  openWindows.set(folderName, {
    element: windowElement,
    folderName: folderName,
    minimized: false,
    maximized: true, // Start maximized
    originalPosition: { x: 20, y: 20 },
    originalSize: { width: 600, height: 400 }
  });
  
  // Add to taskbar
  addToTaskbar(folderName, folderData.title, iconMap[folderName]);
  
  // Focus the new window
  focusWindow(folderName);
}

// Make window draggable
function makeWindowDraggable(windowElement, header) {
  header.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('window-control')) return;
    
    isDragging = true;
    currentDraggedWindow = windowElement;
    const rect = windowElement.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    
    focusWindowByElement(windowElement);
  });
  
  document.addEventListener('mousemove', (e) => {
    if (isDragging && currentDraggedWindow) {
      const windowData = Array.from(openWindows.values()).find(w => w.element === currentDraggedWindow);
      if (windowData && !windowData.maximized) {
        currentDraggedWindow.style.left = `${e.clientX - dragOffset.x}px`;
        currentDraggedWindow.style.top = `${e.clientY - dragOffset.y}px`;
      }
    }
  });
  
  document.addEventListener('mouseup', () => {
    isDragging = false;
    currentDraggedWindow = null;
  });
}

// Focus window
function focusWindow(folderName) {
  const windowData = openWindows.get(folderName);
  if (!windowData) return;
  
  focusWindowByElement(windowData.element);
  updateTaskbarActive(folderName);
}

function focusWindowByElement(windowElement) {
  windowElement.style.zIndex = zIndexCounter++;
  
  // Update taskbar
  const folderName = Array.from(openWindows.entries()).find(([_, data]) => data.element === windowElement)?.[0];
  if (folderName) {
    updateTaskbarActive(folderName);
  }
}

// Minimize window
function minimizeWindow(folderName) {
  const windowData = openWindows.get(folderName);
  if (!windowData) return;
  
  if (windowData.minimized) {
    windowData.element.style.display = 'flex';
    windowData.minimized = false;
  } else {
    windowData.element.style.display = 'none';
    windowData.minimized = true;
  }
  updateTaskbarActive(folderName);
}

// Maximize window
function maximizeWindow(folderName) {
  const windowData = openWindows.get(folderName);
  if (!windowData) return;
  
  if (windowData.maximized) {
    windowData.element.style.width = `${windowData.originalSize.width}px`;
    windowData.element.style.height = `${windowData.originalSize.height}px`;
    windowData.element.style.left = `${windowData.originalPosition.x}px`;
    windowData.element.style.top = `${windowData.originalPosition.y}px`;
    windowData.maximized = false;
  } else {
    windowData.originalPosition.x = parseInt(windowData.element.style.left);
    windowData.originalPosition.y = parseInt(windowData.element.style.top);
    windowData.originalSize.width = windowData.element.offsetWidth;
    windowData.originalSize.height = windowData.element.offsetHeight;
    
    windowData.element.style.width = 'calc(100% - 40px)';
    windowData.element.style.height = 'calc(100% - 100px)';
    windowData.element.style.left = '20px';
    windowData.element.style.top = '20px';
    windowData.maximized = true;
  }
}

// Close window
function closeWindow(folderName) {
  const windowData = openWindows.get(folderName);
  if (!windowData) return;
  
  windowData.element.remove();
  openWindows.delete(folderName);
  removeFromTaskbar(folderName);
}

// Taskbar management
function addToTaskbar(folderName, title, icon) {
  const taskbarApps = document.getElementById('taskbar-apps');
  if (!taskbarApps) return;
  
  const appElement = document.createElement('div');
  appElement.className = 'taskbar-app';
  appElement.id = `taskbar-${folderName}`;
  appElement.innerHTML = `<span>${icon}</span> <span>${title}</span>`;
  appElement.onclick = () => {
    if (openWindows.get(folderName)?.minimized) {
      minimizeWindow(folderName);
    } else {
      focusWindow(folderName);
    }
  };
  
  taskbarApps.appendChild(appElement);
}

function updateTaskbarActive(folderName) {
  document.querySelectorAll('.taskbar-app').forEach(app => {
    app.classList.remove('active');
  });
  
  const appElement = document.getElementById(`taskbar-${folderName}`);
  if (appElement) {
    appElement.classList.add('active');
  }
}

function removeFromTaskbar(folderName) {
  const appElement = document.getElementById(`taskbar-${folderName}`);
  if (appElement) {
    appElement.remove();
  }
}

// Initialize desktop icon interactions
function initDesktopInteractions() {
  const desktopIcons = document.querySelectorAll('.desktop-icon');
  
  if (!desktopIcons.length) {
    setTimeout(initDesktopInteractions, 100);
    return;
  }
  
  desktopIcons.forEach(icon => {
    icon.addEventListener('dblclick', () => {
      const folderName = icon.getAttribute('data-folder');
      const appName = icon.getAttribute('data-app');
      
      if (appName === 'spotify') {
        // Open Spotify profile in new tab
        window.open('https://open.spotify.com/user/312krfzjjp47jrysjdjtw65dbf6a?si=e33dc7fd85854dc5', '_blank');
      } else if (folderName) {
        createWindow(folderName);
      }
    });
    
    icon.addEventListener('click', () => {
      desktopIcons.forEach(i => i.classList.remove('selected'));
      icon.classList.add('selected');
    });
  });
  
  // Click outside to deselect
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.desktop-icon')) {
      desktopIcons.forEach(i => i.classList.remove('selected'));
    }
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDesktopInteractions);
} else {
  initDesktopInteractions();
}

// Parallax notification in top-left (auto-disappear after 2 seconds)
(function createParallaxNotification() {
  // Only show if we're on the portfolio/computer OS overlay, not in room
  if (!document.getElementById('computer-os')) return;

  // Create notification container
  const notif = document.createElement('div');
  notif.id = 'parallax-notification';
  Object.assign(notif.style, {
    position: "fixed",
    top: "32px",
    left: "32px",
    zIndex: 2000,
    pointerEvents: "auto"
  });

  // Create notification content
  const notifContent = document.createElement('div');
  notifContent.style.backdropFilter = 'blur(8px)';
  notifContent.style.background = 'rgba(34, 34, 54, 0.88)';
  notifContent.style.color = '#fff';
  notifContent.style.fontWeight = '600';
  notifContent.style.fontSize = '17px';
  notifContent.style.borderRadius = '14px 14px 18px 4px';
  notifContent.style.boxShadow = '0 4px 32px 0 rgba(22,34,64,0.23), 0 1.5px 0 0 #64b5f6';
  notifContent.style.padding = '18px 34px 16px 20px';
  notifContent.style.minWidth = '240px';
  notifContent.style.cursor = 'pointer';
  notifContent.style.display = 'flex';
  notifContent.style.alignItems = 'center';
  notifContent.style.gap = '12px';
  notifContent.style.transition = 'box-shadow 0.23s, transform 0.2s, opacity 0.5s';
  notifContent.style.userSelect = 'none';
  notifContent.title = "Click here to switch to the 3D Room or explore my Portfolio.";

  // Add image and text
  const img = document.createElement('img');
  img.src = '/windows.png';
  img.alt = 'Room';
  img.style.width = '32px';
  img.style.height = '32px';
  img.style.borderRadius = '6px';
  img.style.boxShadow = '0 1px 4px 0 #0002';
  img.style.objectFit = 'cover';
  img.style.background = '#23234a';

  const span = document.createElement('span');
  span.innerHTML = `<strong>Visit My 3D Portfolio!</strong> <br>
    <em style="font-size:14px;color:#b8e8fc;">Navigate to computer for My Portfolio.</em>`;

  notifContent.appendChild(img);
  notifContent.appendChild(span);
  notif.appendChild(notifContent);
  document.body.appendChild(notif);

  // Simple parallax effect on mousemove
  function parallaxHandler(e) {
    const x = (e.clientX / window.innerWidth - 0.5) * 12;
    const y = (e.clientY / window.innerHeight - 0.5) * 12;
    notifContent.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }
  document.addEventListener('mousemove', parallaxHandler);

  // Notification click handler
  notifContent.addEventListener('click', () => {
    // If we're in "computer-os" overlay, clicking returns to room
    if (typeof window.returnToRoom === 'function') {
      window.returnToRoom();
    } else {
      window.location.reload();
    }
  });

  // Auto-disappear after 2 seconds
  setTimeout(() => {
    notifContent.style.opacity = "0";
    notifContent.style.pointerEvents = "none";
    setTimeout(() => {
      if (notif.parentNode) notif.parentNode.removeChild(notif);
      document.removeEventListener('mousemove', parallaxHandler);
    }, 600);
  }, 2000);
})();




// Animation loop
function tick() {
  if (!isZoomedIn) {
    controls.update();
  }
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

tick();

// Handle resize
window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});
