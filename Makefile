CONTAINER_ID := $(shell docker ps | grep eyeshade-web | awk '{print $$1}')

default: build web-detched migrate

build:
	docker-compose build

web-detached:
	docker-compose up -d eyeshade-web

web:
	docker-compose up eyeshade-web

docker-shell:
	docker exec -it $(CONTAINER_ID) bash

migrate:
	docker exec -it $(CONTAINER_ID) ./bin/migrate-up.sh


