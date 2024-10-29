from setuptools import setup, find_packages

setup(
    name="SimWeb",  # Replace with your application name
    version="0.1.0",
    packages=find_packages(include=["simweb"]),
    install_requires=[
        "flask",
        "netifaces",
        "pyzmq",
    ],
    entry_points={
        'console_scripts': [
            'simweb=simweb.app:main',  # Replace with your actual module path
        ],
    },
    
    # Metadata
    author="Julius Haag",
    author_email="haag.julius@outlook.de",  
    description="Simulation Web Interface for the SimPublisher tool",
    keywords="Simulation SimPublisher WebInterface",
    url="https://github.com/juliushaag/SimWeb",
    python_requires=">=3.6",
)